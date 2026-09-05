import { ApiError, route, WORKSPACE_OWNER } from "@/lib/server/security";
import { completeCanvaAuth } from "@/lib/server/canva";
export const runtime = "nodejs";
export const GET = route(async (req) => {
  const url = new URL(req.url),
    state = url.searchParams.get("state"),
    code = url.searchParams.get("code");
  const cookie = (req.headers.get("cookie") || "")
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("canva_oauth="))
    ?.slice(12);
  if (!state || state !== cookie || !code || code.length > 2000)
    throw new ApiError(
      403,
      "oauth_rejected",
      "Canva 授權未完成或來源驗證失敗，請回到設定重新開始。",
    );
  await completeCanvaAuth(WORKSPACE_OWNER, state, code);
  return new Response(null, {
    status: 303,
    headers: {
      Location: new URL("/", process.env.CONSOLE_ORIGIN).toString(),
      "Cache-Control": "no-store",
      "Set-Cookie": `canva_oauth=; HttpOnly; SameSite=Lax; Path=/api/canva; Max-Age=0${process.env.CONSOLE_ORIGIN?.startsWith("https:") ? "; Secure" : ""}`,
    },
  });
});
