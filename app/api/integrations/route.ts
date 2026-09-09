import { ApiError, authenticate, respond, route } from "@/lib/server/security";
import { health } from "@/lib/server/hermes";
import { integrationsSnapshot } from "@/lib/server/integrations";
import { canvaStatus } from "@/lib/server/canva";
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
  try {
    const snapshot = integrationsSnapshot(owner, await health(owner));
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
      integrations: snapshot.integrations,
      canva,
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
      integrations: [],
      canva: CANVA_UNAVAILABLE,
      degraded: true,
      error: {
        code: "store_unavailable",
        message: "儲存庫無法使用。",
      },
    });
  }
});
