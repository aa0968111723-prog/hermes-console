import { authenticate, respond, route } from "@/lib/server/security";
import { runtimeTools, syncRuntime } from "@/lib/server/hermes/sync-manager";
export const runtime = "nodejs";
export const GET = route(async req => {
  const owner = authenticate(req), url = new URL(req.url);
  const snapshot = await syncRuntime(owner);
  return respond({ tools: runtimeTools(owner, url.searchParams.get("projectId") || undefined, url.searchParams.get("agentId") || undefined), snapshotHash: snapshot.hash, lastSyncedAt: snapshot.lastSyncedAt });
});
