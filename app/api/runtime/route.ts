import { z } from "zod";
import { authenticate, jsonBody, respond, route } from "@/lib/server/security";
import { syncRuntime, runtimeSnapshot } from "@/lib/server/hermes/sync-manager";
export const runtime = "nodejs";
export const GET = route(async (req) => {
  const owner = authenticate(req);
  const snapshot = runtimeSnapshot(owner) || (await syncRuntime(owner));
  void syncRuntime(owner).catch(() => {});
  return respond({ snapshot, stale: snapshot.status === "stale" });
});
export const POST = route(async (req) => {
  const owner = authenticate(req, true);
  z.object({ refresh: z.literal(true) })
    .strict()
    .parse(await jsonBody(req, 2000));
  return respond({ snapshot: await syncRuntime(owner, { force: true }) });
});
