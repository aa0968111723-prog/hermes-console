import type { Task } from "../../contracts";

function done(event: Task["events"][number]) {
  return event.status === "completed" || event.status === "tool.completed";
}

function hasPayload(result: unknown) {
  if (result == null) return false;
  if (typeof result === "string") return result.trim().length > 0;
  if (typeof result !== "object") return true;
  return Object.keys(result as object).length > 0;
}

function completedTool(task: Task, pattern: RegExp) {
  return task.events.some(
    (event) =>
      done(event) &&
      pattern.test(event.toolName || "") &&
      hasPayload(event.result),
  );
}

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
      return done(event) && event.toolName === "workspace_read_material";
    });
    if (!read) return "尚未讀取上傳素材，沒有把檔名當成已看過的圖。";
  }
  if (
    task.goal?.requiresResearch &&
    !completedTool(
      task,
      /galley|xunhe|訊核|tku|tamkang|search|research|browse|fetch/i,
    )
  )
    return "沒有外部資料，沒有把記憶或猜測當成研究結果。";
  if (
    task.goal?.requiresDesign &&
    !completedTool(
      task,
      /canva|lumen|framelab|atlas|visual_concepts|design/i,
    )
  )
    return "還沒有可預覽的作品，沒有把流程跑完當成設計完成。";
  if (task.goal?.requiresLumen && !completedTool(task, /lumen/i))
    return "Lumen 沒有可用結果，沒有假裝已開畫板。";
  return null;
}
