import { z } from "zod";
import { authenticate, jsonBody, respond, route } from "@/lib/server/security";
import {
  AUDIENCE_DISCLAIMER,
  debateSummary,
  normalizeScores,
  tamkangFreshmanSeed,
  wantsReverseThinking,
} from "@/lib/server/audience";
export const runtime = "nodejs";
export const GET = route(async (req) => {
  authenticate(req);
  const prompt = new URL(req.url).searchParams.get("q") || "";
  return respond({
    reverse: wantsReverseThinking(prompt),
    disclaimer: AUDIENCE_DISCLAIMER,
    twin: /淡江|新生/.test(prompt) ? tamkangFreshmanSeed([]) : null,
  });
});
export const POST = route(async (req) => {
  authenticate(req, true);
  const body = z
    .object({
      action: z.enum(["twin", "score", "debate"]),
      label: z.string().max(120).optional(),
      scores: z.record(z.string(), z.number()).optional(),
      support: z.array(z.string().max(500)).max(10).optional(),
      oppose: z.array(z.string().max(500)).max(10).optional(),
      concerns: z.array(z.string().max(500)).max(10).optional(),
      revisions: z.array(z.string().max(500)).max(10).optional(),
    })
    .strict()
    .parse(await jsonBody(req));
  if (body.action === "twin")
    return respond({
      twin: tamkangFreshmanSeed([]),
      disclaimer: AUDIENCE_DISCLAIMER,
    });
  if (body.action === "score")
    return respond(normalizeScores(body.scores || {}));
  return respond(
    debateSummary({
      support: body.support || [],
      oppose: body.oppose || [],
      concerns: body.concerns || [],
      revisions: body.revisions || [],
    }),
  );
});
