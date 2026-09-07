import { authenticate, jsonBody, respond, route } from "@/lib/server/security";
import {
  intelligenceInput,
  runCreativeIntelligence,
} from "@/lib/server/creative/pipeline";
export const runtime = "nodejs";
export const POST = route(async (req) => {
  const owner = authenticate(req, true);
  const body = intelligenceInput.parse(await jsonBody(req));
  return respond(await runCreativeIntelligence(owner, body), 202);
});
