import { ApiError, route } from "@/lib/server/security";
import { tamkangCallback } from "@/lib/server/auth-tamkang";

export const runtime = "nodejs";

export const GET = route(async (req) => {
  const origin = new URL(process.env.CONSOLE_ORIGIN || req.url).origin;
  try {
    const result = await tamkangCallback(new URL(req.url));
    return new Response(null, {
      status: 302,
      headers: {
        Location: origin + "/",
        "Set-Cookie": result.cookie,
      },
    });
  } catch (error) {
    const code =
      error instanceof ApiError ? error.code : "oauth_failed";
    return Response.redirect(origin + "/?auth_error=" + code, 302);
  }
});
