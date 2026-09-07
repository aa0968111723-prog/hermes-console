import { authenticate, respond, route } from "@/lib/server/security";
import { syncRuntime } from "@/lib/server/hermes/sync-manager";
export const runtime = "nodejs";
export const GET = route(async req => { const owner = authenticate(req); const snapshot = await syncRuntime(owner); return respond({ servers: snapshot.mcpServers, snapshotHash: snapshot.hash, lastSyncedAt: snapshot.lastSyncedAt }); });
