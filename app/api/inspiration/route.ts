import { z } from "zod";
import { ApiError, authenticate, jsonBody, respond, route } from "@/lib/server/security";
import {
  inspirationSearchPlan,
  instagramResearchLimits,
  listInspiration,
  pinterestResearchLimits,
} from "@/lib/server/inspiration";
import { searchInspiration, resolveInspirationUrl } from "@/lib/server/inspiration/engine";
import { providerHealth } from "@/lib/server/inspiration/providers";
import { syncSheetsInspiration, sheetsSyncStatus } from "@/lib/server/inspiration/sheets-sync";

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
    sheetsSync: sheetsSyncStatus(),
  });
});

export const POST = route(async (req) => {
  authenticate(req, true);
  const body = z
    .object({
      action: z.enum(["ingest", "search", "sync_sheets"]).default("ingest"),
      url: z.string().url().optional(),
      prompt: z.string().max(2000).optional(),
      projectId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).default("personal"),
      caption: z.string().max(2000).optional(),
      account: z.string().max(120).optional(),
    })
    .strict()
    .parse(await jsonBody(req));
  if (body.action === "sync_sheets")
    return respond({ sheetsSync: await syncSheetsInspiration() });
  if (body.action === "search")
    return respond(
      searchInspiration({
        prompt: body.prompt || "幫我找靈感",
        projectId: body.projectId,
      }),
    );
  if (!body.url)
    throw new ApiError(400, "url_required", "請提供靈感網址。");
  return respond(
    { item: resolveInspirationUrl({ ...body, url: body.url }) },
    201,
  );
});
