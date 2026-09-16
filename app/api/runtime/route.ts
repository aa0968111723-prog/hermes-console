import { z } from "zod";
import {
  authenticate,
  canInspectRuntime,
  jsonBody,
  respond,
  route,
} from "@/lib/server/security";
import { syncRuntime, runtimeSnapshot } from "@/lib/server/hermes/sync-manager";
import { presentRuntimeSnapshot } from "@/lib/server/hermes/runtime-view";
export const runtime = "nodejs";
export const GET = route(async (req) => {
  const owner = authenticate(req);
  const snapshot = runtimeSnapshot(owner) || (await syncRuntime(owner));
  void syncRuntime(owner).catch(() => {});
  return respond({
    snapshot: presentRuntimeSnapshot(snapshot, canInspectRuntime(req)),
    stale: snapshot.status === "stale",
  });
});
export const POST = route(async (req) => {
  const owner = authenticate(req, true);
  z.object({ refresh: z.literal(true) })
    .strict()
    .parse(await jsonBody(req, 2000));
  return respond({
    snapshot: presentRuntimeSnapshot(
      await syncRuntime(owner, { force: true }),
      canInspectRuntime(req),
    ),
  });
});
