import {
  ApiError,
  authenticate,
  isWorkspaceOperator,
  respond,
  route,
} from "@/lib/server/security";
import { healthSnapshot } from "@/lib/server/hermes";
import {
  integrationsSnapshot,
  presentIntegration,
} from "@/lib/server/integrations";
import { canvaStatus, presentCanvaStatus } from "@/lib/server/canva";
export const runtime = "nodejs";

const CANVA_UNAVAILABLE = {
  configured: false,
  state: "unconfigured" as const,
  verifiedAt: null,
  message: "Canva 狀態讀取失敗。",
  needsAuthorization: false,
};

export const GET = route(async (req) => {
  const owner = authenticate(req);
  const operator = isWorkspaceOperator(req);
  try {
    const snapshot = integrationsSnapshot(owner, healthSnapshot(owner));
    let canva: ReturnType<typeof canvaStatus> = CANVA_UNAVAILABLE;
    let degraded = snapshot.degraded;
    try {
      canva = canvaStatus(owner);
    } catch {
      degraded = true;
    }
    const item = snapshot.integrations.find((entry) => entry.id === "canva");
    if (item && canva.configured) {
      item.state = canva.state as typeof item.state;
      item.verifiedAt = canva.verifiedAt;
      item.evidence = canva.message;
    }
    return respond({
      view: operator ? "developer" : "normal",
      integrations: snapshot.integrations.map((entry) =>
        presentIntegration(entry, operator),
      ),
      canva: presentCanvaStatus(canva, operator),
      degraded,
      ...(degraded
        ? {
            error: snapshot.error || {
              code: "store_unavailable",
              message: "儲存庫無法使用。",
            },
          }
        : {}),
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    return respond({
      view: operator ? "developer" : "normal",
      integrations: [],
      canva: presentCanvaStatus(CANVA_UNAVAILABLE, operator),
      degraded: true,
      error: {
        code: "store_unavailable",
        message: "儲存庫無法使用。",
      },
    });
  }
});
