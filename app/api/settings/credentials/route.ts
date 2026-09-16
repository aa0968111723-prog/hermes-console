import { authenticate, jsonBody, respond, route } from "@/lib/server/security";
import { credentialsInput, publicSettings, saveCredentials } from "@/lib/server/settings";
import { requireSettingsWrite } from "@/lib/server/auth/settings-write";

export const runtime = "nodejs";

export const GET = route(async (request) => {
  authenticate(request);
  return respond(publicSettings());
});

export const POST = route(async (request) => {
  requireSettingsWrite(request);
  const body = credentialsInput.parse(await jsonBody(request));
  return respond(saveCredentials(body));
});
