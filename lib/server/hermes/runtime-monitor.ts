import { WORKSPACE_OWNER } from "../security";
import { syncRuntime } from "./sync-manager";

const globalMonitor = globalThis as typeof globalThis & {
  runtimeMonitorV2?: ReturnType<typeof setInterval>;
};
export function startRuntimeMonitor() {
  if (globalMonitor.runtimeMonitorV2) return;
  const tick = () => {
    void syncRuntime(WORKSPACE_OWNER).catch(() => {
      /* Keep last known state; no replay of tools. */
    });
  };
  // Cache/backoff lives in syncRuntime. Browser count never changes this schedule.
  globalMonitor.runtimeMonitorV2 = setInterval(tick, 5000);
  globalMonitor.runtimeMonitorV2.unref();
  tick();
}
export function stopRuntimeMonitor() {
  clearInterval(globalMonitor.runtimeMonitorV2);
  globalMonitor.runtimeMonitorV2 = undefined;
}
