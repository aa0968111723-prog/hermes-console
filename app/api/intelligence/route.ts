import { z } from "zod";
import { authenticate, jsonBody, respond, route } from "@/lib/server/security";
import { runCreativeIntelligence } from "@/lib/server/creative/pipeline";
import { wantsReverseThinking } from "@/lib/server/audience";
export const runtime = "nodejs";
export const POST = route(async (req) => {
  authenticate(req, true);
  const body = z
    .object({
      prompt: z.string().trim().min(1).max(4000),
      projectId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).default("personal"),
      tamkangReachable: z.boolean().optional(),
    })
    .strict()
    .parse(await jsonBody(req));
  const result = runCreativeIntelligence(body);
  return respond({
    reverse: wantsReverseThinking(body.prompt),
    ...result,
  });
});
