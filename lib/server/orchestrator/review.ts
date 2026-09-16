import type { Task } from "../../contracts";

export function completionNotice(task: Task) {
  const failed = task.events.filter((event) => {
    const tool = event.kind === "tool" || Boolean(event.toolName);
    return (
      tool &&
      /fail|error|waiting_authorization/i.test(event.status || "")
    );
  });
  if (failed.length) return "有工具沒有完成，沒有用猜測補上結果。";
  return null;
}
