import { respond, route } from "@/lib/server/security";
import { probeStore } from "@/lib/server/store";
import type { ReadyStatus } from "@/lib/contracts";

export const runtime = "nodejs";

export const GET = route(async () => {
  const probe = probeStore();
  const body: ReadyStatus = {
    ready: probe.ok,
    backend: probe.backend,
    dataDir: probe.dataDir,
  };
  if (!probe.ok) {
    body.error = {
      code: "store_unavailable",
      message: "儲存庫無法使用。",
    };
  }
  return respond(body, probe.ok ? 200 : 503);
});
