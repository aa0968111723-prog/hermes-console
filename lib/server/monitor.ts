import { active, reconcile } from "./tasks";
import { list } from "./store";
import type { Task } from "../contracts";
const globalMonitor = globalThis as typeof globalThis & {
  hermesMonitor?: ReturnType<typeof setInterval>;
};
export function startMonitor() {
  if (globalMonitor.hermesMonitor || !process.env.CONSOLE_PASSWORD_HASH) return;
  let busy = false;
  globalMonitor.hermesMonitor = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      for (const task of list<Task>("task", "owner").filter(active))
        await reconcile("owner", task.id);
    } catch {
      /* Keep stored tasks; never replay a submission on recovery. */
    } finally {
      busy = false;
    }
  }, 5000);
  globalMonitor.hermesMonitor.unref();
}
