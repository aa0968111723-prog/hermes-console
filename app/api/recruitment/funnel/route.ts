import { ApiError, authenticate, respond, route } from "@/lib/server/security";
import { buildRecruitmentFunnelRead } from "@/lib/server/recruitment/funnel";

export const runtime = "nodejs";

export const GET = route(async (req) => {
  authenticate(req);
  try {
    return respond(buildRecruitmentFunnelRead());
  } catch (error) {
    if (error instanceof ApiError) throw error;
    // Store/catalog wobble: never blank 500; return degraded read model.
    const fallback = buildRecruitmentFunnelRead({
      loadCatalog: () => {
        throw new Error("catalog_unavailable");
      },
      loadGraph: () => {
        throw new Error("graph_unavailable");
      },
      sheetsSyncStatus: () => {
        throw new Error("sheets_sync_unavailable");
      },
    });
    return respond({ ...fallback, degraded: true });
  }
});