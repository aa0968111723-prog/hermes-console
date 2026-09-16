import { active, reconcile } from "./tasks";
import { list } from "./store";
import type { Task } from "../contracts";
import { WORKSPACE_OWNER } from "./security";

const globalMonitor = globalThis as typeof globalThis & {
  hermesMonitor?: ReturnType<typeof setInterval>;
  hermesMonitorBusy?: boolean;
};

/** After process restart, in-memory chat workers are gone. Do not leave tasks as running. */
export async function recoverOrphanedTasks() {
  for (const owner of [WORKSPACE_OWNER, "owner"]) {
    for (const task of list<Task>("task", owner).filter(active))
      await reconcile(owner, task.id);
  }
}

export function startMonitor() {
  if (globalMonitor.hermesMonitor) return;
  const tick = async () => {
    if (globalMonitor.hermesMonitorBusy) return;
    globalMonitor.hermesMonitorBusy = true;
    try {
      await recoverOrphanedTasks();
    } catch {
      /* Keep stored tasks; never replay a submission on recovery. */
    } finally {
      globalMonitor.hermesMonitorBusy = false;
    }
  };
  void tick();
  globalMonitor.hermesMonitor = setInterval(() => void tick(), 5000);
  globalMonitor.hermesMonitor.unref();
}
