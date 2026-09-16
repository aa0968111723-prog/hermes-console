import { active, reconcile } from "./tasks";
import { list } from "./store";
import type { Task } from "../contracts";
import { WORKSPACE_OWNER } from "./security";
const globalMonitor = globalThis as typeof globalThis & {
  hermesMonitor?: ReturnType<typeof setInterval>;
};

export async function reconcileActiveTasks() {
  for (const owner of [WORKSPACE_OWNER, "owner"])
    for (const task of list<Task>("task", owner).filter(active))
      await reconcile(owner, task.id);
}

export function startMonitor() {
  if (globalMonitor.hermesMonitor) return;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await reconcileActiveTasks();
    } catch {
      /* Keep stored tasks; never replay a submission on recovery. */
    } finally {
      busy = false;
    }
  };
  void tick();
  globalMonitor.hermesMonitor = setInterval(tick, 5000);
  globalMonitor.hermesMonitor.unref();
}
