import { ApiError, route } from "@/lib/server/security";
import { optionalUser } from "@/lib/server/identity";
import { googleStart } from "@/lib/server/auth-google";

export const runtime = "nodejs";

export const GET = route(async (req) => {
  const origin = new URL(process.env.CONSOLE_ORIGIN || req.url).origin;
  try {
    const location = googleStart(optionalUser(req)?.id);
    return Response.redirect(location, 302);
  } catch (error) {
    if (error instanceof ApiError && error.code === "oauth_unconfigured")
      return Response.redirect(origin + "/?auth_error=google_unconfigured", 302);
    throw error;
  }
});
