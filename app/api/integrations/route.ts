import { authenticate, respond, route } from "@/lib/server/security";
import { health } from "@/lib/server/hermes";
import { integrations } from "@/lib/server/integrations";
import { canvaStatus } from "@/lib/server/canva";
export const runtime = "nodejs";
export const GET = route(async (req) => {
  const owner = authenticate(req),
    items = integrations(owner, await health(owner)),
    canva = canvaStatus(owner);
  const item = items.find((i) => i.id === "canva")!;
  if (canva.configured) {
    item.state = canva.state as typeof item.state;
    item.verifiedAt = canva.verifiedAt;
    item.evidence = canva.message;
  }
  return respond({ integrations: items, canva });
});
