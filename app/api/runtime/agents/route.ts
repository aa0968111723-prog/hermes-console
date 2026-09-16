import { authenticateOperator, respond, route } from "@/lib/server/security";
import { syncRuntime } from "@/lib/server/hermes/sync-manager";
export const runtime = "nodejs";
export const GET = route(async (req) => {
  const owner = authenticateOperator(req);
  const snapshot = await syncRuntime(owner);
  return respond({
    agents: snapshot.agents,
    snapshotHash: snapshot.hash,
    lastSyncedAt: snapshot.lastSyncedAt,
  });
});
