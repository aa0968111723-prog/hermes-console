import { route } from "@/lib/server/security";
import { startGoogleOAuth } from "@/lib/server/auth-providers";
import { currentUser } from "@/lib/server/identity";

export const runtime = "nodejs";

export const GET = route(async (req) => {
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") === "link" ? "link" : "login";
  let userId: string | undefined;
  if (mode === "link") userId = currentUser(req).id;
  const target = startGoogleOAuth(mode, userId);
  return Response.redirect(target, 302);
});
