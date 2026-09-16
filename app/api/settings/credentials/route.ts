import { authenticate, jsonBody, respond, route } from "@/lib/server/security";
import { credentialsInput, publicSettings, saveCredentials } from "@/lib/server/settings";
import { isAuthRequired } from "@/lib/server/auth/mode";
import { requireAccess, requireRole } from "@/lib/server/auth/session";

export const runtime = "nodejs";

export const GET = route(async (request) => {
  authenticate(request);
  return respond(publicSettings());
});

export const POST = route(async (request) => {
  authenticate(request, true);
  if (isAuthRequired())
    requireRole(requireAccess(request).membership, ["owner", "admin"]);
  const body = credentialsInput.parse(await jsonBody(request));
  return respond(saveCredentials(body));
});
