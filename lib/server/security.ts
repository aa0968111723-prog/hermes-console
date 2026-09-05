import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import { db } from "./store";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function redact(text: string) {
  let output = text;
  for (const [name, value] of Object.entries(process.env)) {
    if (/(KEY|TOKEN|PASSWORD|SECRET)/i.test(name) && value && value.length >= 6)
      output = output.split(value).join("[redacted]");
  }
  return output
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replace(/\bsk-[a-zA-Z0-9_-]{12,}/g, "[redacted]");
}
export function limited(key: string, maximum: number, windowMs: number) {
  const now = Date.now();
  db().prepare("DELETE FROM limits WHERE expires < ?").run(now);
  db()
    .prepare(
      "INSERT INTO limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1",
    )
    .run(key, now + windowMs);
  const row = db().prepare("SELECT count FROM limits WHERE key=?").get(key)!;
  if (Number(row.count) > maximum)
    throw new ApiError(429, "rate_limited", "請稍後再試，請求次數已達限制。");
}
export function checkOrigin(request: Request) {
  const configured = process.env.CONSOLE_ORIGIN;
  if (!configured)
    throw new ApiError(503, "setup_required", "後端尚未設定 CONSOLE_ORIGIN。");
  if (request.headers.get("origin") !== new URL(configured).origin)
    throw new ApiError(
      403,
      "origin_rejected",
      "來源驗證失敗，請重新載入工作區。",
    );
}
export function authenticate(request: Request, mutation = false): string {
  if (mutation) checkOrigin(request);
  const cookie = (request.headers.get("cookie") || "")
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("hermes_session="))
    ?.slice(15);
  if (!cookie || !/^[a-f0-9]{64}$/.test(cookie))
    throw new ApiError(401, "unauthorized", "請先登入。");
  const session = db()
    .prepare("SELECT owner,expires FROM sessions WHERE digest=?")
    .get(hash(cookie));
  if (!session || Number(session.expires) <= Date.now())
    throw new ApiError(401, "unauthorized", "登入已到期，請重新登入。");
  const owner = String(session.owner);
  limited("api:" + owner, 240, 60_000);
  return owner;
}
export function verifyPassword(password: string, encoded: string) {
  const [scheme, salt, value] = encoded.split(":");
  if (
    scheme !== "scrypt" ||
    !/^[a-f0-9]{32}$/.test(salt || "") ||
    !/^[a-f0-9]{128}$/.test(value || "")
  )
    return false;
  return timingSafeEqual(
    scryptSync(password, salt, 64),
    Buffer.from(value, "hex"),
  );
}
export function login(username: string, password: string) {
  limited("login:global", 20, 15 * 60_000);
  const expected = process.env.CONSOLE_PASSWORD_HASH;
  if (!expected || !process.env.CONSOLE_USERNAME)
    throw new ApiError(
      503,
      "setup_required",
      "請在後端設定工作區帳號與新的密碼雜湊。",
    );
  const verified = verifyPassword(password, expected);
  if (username !== process.env.CONSOLE_USERNAME || !verified)
    throw new ApiError(401, "invalid_login", "帳號或密碼不正確。");
  const token = randomBytes(32).toString("hex");
  db().prepare("DELETE FROM sessions WHERE expires < ?").run(Date.now());
  db()
    .prepare("INSERT INTO sessions VALUES(?,?,?)")
    .run(hash(token), "owner", Date.now() + 12 * 60 * 60_000);
  return token;
}
export function sessionCookie(token: string, logout = false) {
  const secure = process.env.CONSOLE_ORIGIN?.startsWith("https://")
    ? "; Secure"
    : "";
  return `hermes_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${logout ? 0 : 43200}${secure}`;
}
export async function jsonBody(
  request: Request,
  maxBytes = 64_000,
): Promise<unknown> {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new ApiError(415, "content_type", "需要 JSON 請求。");
  if (Number(request.headers.get("content-length")) > maxBytes)
    throw new ApiError(413, "too_large", "請求內容過大。");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "invalid_body", "缺少請求內容。");
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new ApiError(413, "too_large", "請求內容過大。");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError(400, "invalid_json", "JSON 格式錯誤。");
  }
}
export function respond(
  value: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}
export function route(fn: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    try {
      return await fn(req);
    } catch (error) {
      if (error instanceof ApiError)
        return respond(
          { error: { code: error.code, message: error.message } },
          error.status,
          error.status === 429 ? { "Retry-After": "60" } : {},
        );
      if (error instanceof z.ZodError)
        return respond(
          {
            error: {
              code: "invalid_input",
              message: "輸入格式不正確，請確認欄位與長度。",
            },
          },
          400,
        );
      return respond(
        {
          error: {
            code: "internal_error",
            message: "操作未完成，請查看設定或重試。",
          },
        },
        500,
      );
    }
  };
}
