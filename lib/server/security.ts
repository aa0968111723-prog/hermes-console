import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import {
  createSession,
  get,
  hitLimit,
  put,
  transaction,
  StoreUnavailableError,
} from "./store";

export const WORKSPACE_OWNER = "workspace";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const METADATA_HOSTS = new Set([
  "169.254.169.254",
  "metadata.google.internal",
]);

export function normalizeServiceHost(hostname: string) {
  let host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host.endsWith(".")) host = host.slice(0, -1);
  if (host.startsWith("::ffff:")) {
    const suffix = host.slice(7);
    if (suffix.includes(".")) return suffix;
    const parts = suffix.split(":").map((part) => parseInt(part, 16));
    if (parts.length === 2 && parts.every((part) => Number.isInteger(part))) {
      return [
        (parts[0] >> 8) & 0xff,
        parts[0] & 0xff,
        (parts[1] >> 8) & 0xff,
        parts[1] & 0xff,
      ].join(".");
    }
  }
  return host;
}

export function isLoopbackHost(hostname: string) {
  const host = normalizeServiceHost(hostname);
  return (
    LOOPBACK_HOSTS.has(hostname.toLowerCase()) ||
    LOOPBACK_HOSTS.has(host) ||
    host === "::1" ||
    host === "localhost" ||
    /^127(?:\.\d{1,3}){3}$/.test(host)
  );
}

export function isPrivateOrReservedHost(hostname: string) {
  const host = normalizeServiceHost(hostname);
  if (
    isLoopbackHost(hostname) ||
    METADATA_HOSTS.has(host) ||
    host === "0.0.0.0" ||
    host === "::" ||
    host === ""
  )
    return true;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
  }
  if (host.includes(":")) {
    if (
      host === "::1" ||
      host.startsWith("fe80:") ||
      /^f[cd][0-9a-f]{0,2}:/i.test(host)
    )
      return true;
  }
  return false;
}

export function assertSafeServiceUrl(
  value: string,
  kind: "service" | "mcp" | "hermes" = "service",
) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError(400, "invalid_url", "網址格式不正確。");
  }
  const local =
    process.env.HERMES_ALLOW_LOOPBACK_HTTP === "true" &&
    isLoopbackHost(url.hostname);
  if (
    (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new ApiError(
      400,
      "invalid_url",
      kind === "hermes"
        ? "Hermes 服務設定不安全；需要無帳密與查詢參數的 HTTPS 網域。"
        : kind === "mcp"
          ? "MCP 目標需為無帳密與查詢參數的受控 HTTPS 端點。"
          : "需為無帳密與查詢參數的受控 HTTPS 端點。",
    );
  if (!local && isPrivateOrReservedHost(url.hostname))
    throw new ApiError(
      400,
      "ssrf_rejected",
      "禁止連線至私有內網或雲端中繼端點。",
    );
  return url;
}

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
let extraSecretValues: () => string[] = () => [];
export function registerRedactionSecrets(fn: () => string[]) {
  extraSecretValues = fn;
}
export function redact(text: string) {
  let output = text;
  for (const value of extraSecretValues()) {
    if (value && value.length >= 6)
      output = output.split(value).join("[redacted]");
  }
  for (const [name, value] of Object.entries(process.env)) {
    if (/(KEY|TOKEN|PASSWORD|SECRET)/i.test(name) && value && value.length >= 6)
      output = output.split(value).join("[redacted]");
  }
  return output
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replace(/\bsk-[a-zA-Z0-9_-]{12,}/g, "[redacted]");
}
export function limited(key: string, maximum: number, windowMs: number) {
  if (hitLimit(key, windowMs) > maximum)
    throw new ApiError(429, "rate_limited", "請稍後再試，請求次數已達限制。");
}
function requestOrigin(request: Request) {
  try {
    return new URL(request.url).origin;
  } catch {
    return "";
  }
}
function isLoopbackOrigin(origin: string) {
  try {
    const url = new URL(origin);
    return LOOPBACK_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}
export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin") || "";
  const configured = process.env.CONSOLE_ORIGIN?.trim();
  if (configured) {
    let expected = "";
    try {
      expected = new URL(configured).origin;
    } catch {
      throw new ApiError(503, "setup_required", "後端尚未設定 CONSOLE_ORIGIN。");
    }
    if (origin !== expected)
      throw new ApiError(
        403,
        "origin_rejected",
        "來源驗證失敗，請重新載入工作區。",
      );
    return;
  }
  const incoming = requestOrigin(request);
  if (origin && incoming && origin === incoming && isLoopbackOrigin(origin))
    return;
  throw new ApiError(
    503,
    "setup_required",
    "後端尚未設定 CONSOLE_ORIGIN。",
  );
}
export function authenticate(request: Request, mutation = false): string {
  if (process.env.CONSOLE_GATEWAY_SECRET || process.env.CONSOLE_REQUIRE_GATEWAY === "true")
    verifyGateway(request);
  if (mutation) checkOrigin(request);
  limited("api:" + WORKSPACE_OWNER, 240, 60_000);
  return WORKSPACE_OWNER;
}

// Optional deployment-level protection. Not an account login.
// The gateway must replace this header, never forward a browser-provided value.
export function verifyGateway(request: Request) {
  const secret = process.env.CONSOLE_GATEWAY_SECRET || "";
  if (secret.length >= 32) {
    const provided = request.headers.get("x-console-gateway") || "";
    if (
      !timingSafeEqual(Buffer.from(hash(secret)), Buffer.from(hash(provided)))
    )
      throw new ApiError(
        401,
        "gateway_required",
        "請從已授權的存取閘道開啟工作區。",
      );
    return;
  }
  // Explicit isolated local development only. Ignore forwarded/Host headers.
  let local = false;
  try {
    const configured = new URL(process.env.CONSOLE_ORIGIN || "");
    const incoming = new URL(request.url);
    local =
      ["localhost", "127.0.0.1", "[::1]"].includes(configured.hostname) &&
      ["localhost", "127.0.0.1", "[::1]"].includes(incoming.hostname) &&
      incoming.protocol === configured.protocol &&
      incoming.port === configured.port;
  } catch {
    /* fail closed */
  }
  if (process.env.CONSOLE_ALLOW_LOCAL_ACCESS === "true" && local && !secret)
    return;
  throw new ApiError(
    503,
    "gateway_unconfigured",
    "工作區尚未設定受控存取閘道，API 已暫停對外使用。",
  );
}

export type ConfirmationRecord = {
  id: string;
  action: string;
  target: string;
  payloadHash: string;
  expiresAt: number;
  used: boolean;
};

export function payloadDigest(payload: unknown) {
  return hash(JSON.stringify(payload ?? null));
}

export function mintConfirmation(input: {
  action: string;
  target: string;
  payload: unknown;
  ttlMs?: number;
}) {
  const token = randomBytes(32).toString("hex");
  const expiresAt =
    Date.now() + Math.min(input.ttlMs || 5 * 60_000, 15 * 60_000);
  put("confirmation", WORKSPACE_OWNER, {
    id: hash(token),
    action: input.action,
    target: input.target,
    payloadHash: payloadDigest(input.payload),
    expiresAt,
    used: false,
  } satisfies ConfirmationRecord);
  return { token, expiresAt, action: input.action, target: input.target };
}

export function consumeConfirmation(input: {
  token: unknown;
  action: string;
  target: string;
  payload: unknown;
}) {
  if (input.token === true || input.token === "true")
    throw new ApiError(
      403,
      "confirmation_required",
      "前端 confirmed=true 不足；此操作需要伺服器核發的一次性確認。",
    );
  const token = typeof input.token === "string" ? input.token : "";
  if (!/^[a-f0-9]{64}$/.test(token))
    throw new ApiError(
      403,
      "confirmation_required",
      "此操作需要伺服器核發的一次性確認。",
    );
  transaction(() => {
    const record = get<ConfirmationRecord>(
      "confirmation",
      WORKSPACE_OWNER,
      hash(token),
    );
    if (!record || record.used || record.expiresAt < Date.now())
      throw new ApiError(
        403,
        "confirmation_invalid",
        "確認已失效、已使用或不存在，請重新確認。",
      );
    if (
      record.action !== input.action ||
      record.target !== input.target ||
      record.payloadHash !== payloadDigest(input.payload)
    )
      throw new ApiError(
        403,
        "confirmation_mismatch",
        "確認內容與操作不符，請重新確認。",
      );
    put("confirmation", WORKSPACE_OWNER, { ...record, used: true });
  });
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
  createSession(hash(token), "owner", Date.now() + 12 * 60 * 60_000);
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
      if (error instanceof StoreUnavailableError)
        return respond(
          {
            error: {
              code: "store_unavailable",
              message: "儲存庫無法使用。",
            },
          },
          503,
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
