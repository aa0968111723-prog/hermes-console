import { z } from "zod";
import { authenticate, jsonBody, respond, route } from "@/lib/server/security";
import {
  ingestUrl,
  inspirationSearchPlan,
  instagramResearchLimits,
  listInspiration,
  pinterestResearchLimits,
} from "@/lib/server/inspiration";
export const runtime = "nodejs";
export const GET = route(async (req) => {
  authenticate(req);
  const projectId = new URL(req.url).searchParams.get("projectId") || undefined;
  return respond({
    items: listInspiration(projectId),
    instagram: instagramResearchLimits(),
    pinterest: pinterestResearchLimits(),
    plan: inspirationSearchPlan("幫我找靈感"),
  });
});
export const POST = route(async (req) => {
  authenticate(req, true);
  const body = z
    .object({
      url: z.string().url(),
      projectId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).default("personal"),
      caption: z.string().max(2000).optional(),
      account: z.string().max(120).optional(),
    })
    .strict()
    .parse(await jsonBody(req));
  return respond({ item: ingestUrl(body) }, 201);
});
