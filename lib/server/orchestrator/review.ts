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
  if (task.goal?.requiresImageRead) {
    const read = task.events.some((event) => {
      const done =
        event.status === "completed" || event.status === "tool.completed";
      return done && event.toolName === "workspace_read_material";
    });
    if (!read) return "尚未讀取上傳素材，沒有把檔名當成已看過的圖。";
  }
  return null;
}
