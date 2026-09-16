import { ExternalLink, Search, Check, Circle } from "lucide-react";
import type { Task } from "@/lib/contracts";
import { eventState, highLevelProgress, safeSource } from "@/lib/client/activity";
import { isTwinPanel } from "@/lib/server/audience/personas";
import FirstReactionBoard from "../audience/FirstReactionBoard";
import InspirationResult from "./InspirationResult";
import { isInspirationBrief } from "@/lib/client/inspiration-result";
import { layoutFromTask } from "@/lib/client/planform-layout";
import PlanformStage from "./PlanformStage";
export default function VisualMessage({
  task,
  onInspect,
  onUseDirection,
}: {
  task?: Task;
  onInspect: () => void;
  onUseDirection?: (prompt: string) => void;
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
  const progress = highLevelProgress(task);
  const twinPanel = task.events.map((event) => event.result).find(isTwinPanel);
  const inspiration = task.events
    .map((event) => event.result)
    .find(isInspirationBrief);
  if (!sources.length && !calls.size && !twinPanel && !layout && !inspiration)
    return null;
  return (
    <div className="visual-message">
      {layout && <PlanformStage layout={layout} />}
      {!!calls.size && (
        <button
          className="tool-result-summary"
          onClick={onInspect}
          aria-label={"查看任務：" + progress.label}
        >
          {progress.label === "完成" ? (
            <Check size={15} />
          ) : (
            <Circle size={15} />
          )}
          <span>{progress.label}</span>
          {!!progress.stages.length && (
            <ol className="progress-trail">
              {progress.stages.map((stage) => (
                <li key={stage.id} data-state={stage.state}>
                  {stage.label}
                </li>
              ))}
            </ol>
          )}
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
      {twinPanel && <FirstReactionBoard panel={twinPanel} />}
      {inspiration && (
        <InspirationResult brief={inspiration} onUseDirection={onUseDirection} />
      )}
    </div>
  );
}
