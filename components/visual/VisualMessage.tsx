import { ExternalLink, Search, Check, Circle } from "lucide-react";
import type { Task } from "@/lib/contracts";
import { eventState, safeSource } from "@/lib/client/activity";
import { layoutFromTask } from "@/lib/client/planform-layout";
import PlanformStage from "./PlanformStage";
export default function VisualMessage({
  task,
  onInspect,
}: {
  task?: Task;
  onInspect: () => void;
}) {
  if (!task) return null;
  const layout = layoutFromTask(task);
  const sources = [...new Set(task.events.flatMap((event) => event.sources))]
    .map(safeSource)
    .filter((value): value is string => !!value);
  const calls = new Map<string, string>();
  for (const event of task.events)
    if (event.toolName)
      calls.set(event.toolCallId || event.toolName, eventState(event));
  const completed = [...calls.values()].filter(
    (state) => state === "completed",
  ).length;
  if (!sources.length && !calls.size && !layout) return null;
  return (
    <div className="visual-message">
      {layout && <PlanformStage layout={layout} />}
      {!!calls.size && (
        <button className="tool-result-summary" onClick={onInspect}>
          {completed === calls.size ? (
            <Check size={15} />
          ) : (
            <Circle size={15} />
          )}
          {completed} / {calls.size} 個工具完成
        </button>
      )}
      {!!sources.length && (
        <details className="source-cards">
          <summary>
            <Search size={15} />
            {sources.length} 個來源
          </summary>
          <div className="source-grid">
            {sources.map((source) => (
              <a
                className="source-card"
                key={source}
                href={source}
                target="_blank"
                rel="noopener noreferrer"
                title={source}
              >
                <ExternalLink size={18} />
                <span>
                  {new URL(source).hostname}
                  <small>{new URL(source).pathname}</small>
                </span>
              </a>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
