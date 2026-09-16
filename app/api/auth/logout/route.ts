import { checkOrigin, respond, route } from "@/lib/server/security";
import { authCookie, clearRequestSession } from "@/lib/server/auth";

export const runtime = "nodejs";

export const POST = route(async (req) => {
  checkOrigin(req);
  clearRequestSession(req);
  return respond({ signedOut: true }, 200, {
    "Set-Cookie": authCookie("", true),
  });
});
