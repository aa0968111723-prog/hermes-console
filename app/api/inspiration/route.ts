import { z } from "zod";
import { ApiError, authenticate, jsonBody, respond, route } from "@/lib/server/security";
import {
  inspirationSearchPlan,
  instagramResearchLimits,
  listInspiration,
  pinterestResearchLimits,
} from "@/lib/server/inspiration";
import { searchInspiration, resolveInspirationUrl, toInspirationPack, selectInspirationDirection } from "@/lib/server/inspiration/engine";
import { providerHealth } from "@/lib/server/inspiration/providers";
import { syncSheetsInspiration, sheetsSyncStatus } from "@/lib/server/inspiration/sheets-sync";
import { tkuVisualLanguage } from "@/lib/server/inspiration/visual-language";

export const runtime = "nodejs";

export const GET = route(async (req) => {
  authenticate(req);
  const projectId = new URL(req.url).searchParams.get("projectId") || undefined;
  const items = listInspiration(projectId);
  return respond({
    items,
    pack: toInspirationPack({
      prompt: "靈感板",
      projectId: projectId || "personal",
      items,
    }),
    instagram: instagramResearchLimits(),
    pinterest: pinterestResearchLimits(),
    plan: inspirationSearchPlan("幫我找靈感"),
    providers: providerHealth(),
    sheetsSync: sheetsSyncStatus(),
    visualLanguage: tkuVisualLanguage(),
  });
});

export const POST = route(async (req) => {
  const owner = authenticate(req, true);
  const body = z
    .object({
      action: z
        .enum(["ingest", "search", "sync_sheets", "select"])
        .default("ingest"),
      url: z.string().url().optional(),
      prompt: z.string().max(2000).optional(),
      projectId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).default("personal"),
      caption: z.string().max(2000).optional(),
      account: z.string().max(120).optional(),
      selected: z.enum(["A", "B", "C"]).optional(),
      conversationId: z.string().uuid().optional(),
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
  if (body.action === "select") {
    if (!body.selected)
      throw new ApiError(400, "invalid_direction", "請選擇其中一個創作方向。");
    const result = selectInspirationDirection({
      owner,
      prompt: body.prompt || "靈感板",
      projectId: body.projectId,
      selected: body.selected,
      conversationId: body.conversationId,
    });
    return respond({
      workflow: {
        id: result.workflow.id,
        state: result.workflow.state,
        selected: result.workflow.selected,
        selectedTitle:
          result.workflow.selected === null
            ? null
            : result.workflow.directions[result.workflow.selected]?.title ||
              null,
        directionBrief: result.workflow.directionBrief || null,
      },
      pack: {
        kind: result.pack.kind,
        fullSiteSearch: false,
        itemCount: result.pack.itemCount,
      },
      brief: result.workflow.directionBrief || null,
    });
  }
  if (!body.url)
    throw new ApiError(400, "url_required", "請提供靈感網址。");
  return respond(
    { item: resolveInspirationUrl({ ...body, url: body.url }) },
    201,
  );
});
