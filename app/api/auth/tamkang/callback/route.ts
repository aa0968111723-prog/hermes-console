import { route } from "@/lib/server/security";
import { finishTamkangOAuth } from "@/lib/server/auth-providers";
import { currentUser, sessionHeader } from "@/lib/server/identity";
import { ApiError } from "@/lib/server/errors";

export const runtime = "nodejs";

function origin() {
  try {
    return new URL(process.env.CONSOLE_ORIGIN || "").origin;
  } catch {
    return "";
  }
}

export const GET = route(async (req) => {
  const url = new URL(req.url);
  let actor: string | undefined;
  try {
    actor = currentUser(req).id;
  } catch {
    actor = undefined;
  }
  try {
    const token = await finishTamkangOAuth(url, actor);
    return new Response(null, {
      status: 303,
      headers: {
        Location: origin() + "/",
        "Set-Cookie": sessionHeader(token),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message =
      error instanceof ApiError ? error.message : "淡江 SSO 尚未完成設定";
    return new Response(null, {
      status: 303,
      headers: {
        Location: origin() + "/?auth_error=" + encodeURIComponent(message),
        "Cache-Control": "no-store",
      },
    });
  }
});
