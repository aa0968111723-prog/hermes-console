import { route } from "@/lib/server/security";
import { startGoogleFromRequest } from "@/lib/server/auth";

export const runtime = "nodejs";

export const GET = route(async (req) => {
  const url = new URL(req.url);
  const purpose = url.searchParams.get("purpose") === "link" ? "link" : "login";
  return Response.redirect(startGoogleFromRequest(req, purpose), 302);
});
