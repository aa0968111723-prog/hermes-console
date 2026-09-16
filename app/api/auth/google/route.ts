import { authenticate } from "@/lib/server/security";
import { startGoogleAuth } from "@/lib/server/auth/providers/google";
import { readAccess } from "@/lib/server/auth/session";

export const runtime = "nodejs";

export const GET = async (request: Request) => {
  try {
    authenticate(request, false, { anonymous: true });
    const location = startGoogleAuth(readAccess(request)?.user.id);
    return new Response(null, {
      status: 302,
      headers: { Location: location, "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Google 登入尚未完成設定";
    return new Response(null, {
      status: 302,
      headers: {
        Location:
          (process.env.CONSOLE_ORIGIN || "") +
          "/?auth_error=" +
          encodeURIComponent(message),
        "Cache-Control": "no-store",
      },
    });
  }
};
