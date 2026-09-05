import { z } from "zod";
import { ApiError, authenticate, jsonBody, respond, route } from "@/lib/server/security";
import {
  inspirationSearchPlan,
  instagramResearchLimits,
  listInspiration,
  pinterestResearchLimits,
} from "@/lib/server/inspiration";
import { resolveInspirationUrl, runInspirationPipeline } from "@/lib/server/inspiration/engine";
import { providerHealth } from "@/lib/server/inspiration/providers";
export const runtime = "nodejs";
export const GET = route(async (req) => {
  authenticate(req);
  const projectId = new URL(req.url).searchParams.get("projectId") || undefined;
  return respond({
    items: listInspiration(projectId),
    instagram: instagramResearchLimits(),
    pinterest: pinterestResearchLimits(),
    plan: inspirationSearchPlan("幫我找靈感"),
    providers: providerHealth(),
    fullSiteSearch: false,
    liveFetch: false,
  });
});
export const POST = route(async (req) => {
  authenticate(req, true);
  const body = z
    .object({
      action: z.enum(["ingest", "search"]).default("ingest"),
      url: z.string().url().optional(),
      prompt: z.string().max(2000).optional(),
      projectId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).default("personal"),
      caption: z.string().max(2000).optional(),
      account: z.string().max(120).optional(),
    })
    .strict()
    .parse(await jsonBody(req));
  if (body.action === "search") {
    const pipeline = runInspirationPipeline({
      prompt: body.prompt || "幫我找靈感",
      projectId: body.projectId,
      url: body.url,
    });
    return respond({
      ...pipeline,
      items: pipeline.savedItems,
    });
  }
  if (!body.url)
    throw new ApiError(400, "url_required", "請提供靈感網址。");
  return respond(
    { item: resolveInspirationUrl({ ...body, url: body.url }) },
    201,
  );
});
