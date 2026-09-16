import { ExternalLink, Search, Check, Circle, CircleHelp } from "lucide-react";
import type { Task, TaskFocus } from "@/lib/contracts";
import {
  artifactsForConversation,
  progressSteps,
  safeSource,
  studentProcessDone,
  taskKeptSpecOnly,
  visualProcessCaption,
} from "@/lib/client/activity";
import { isTwinPanel } from "@/lib/server/audience/personas";
import FirstReactionBoard from "../audience/FirstReactionBoard";
import { layoutFromTask } from "@/lib/client/planform-layout";
import PlanformStage from "./PlanformStage";
import ArtifactStage from "./ArtifactStage";

export default function VisualMessage({
  task,
  onInspect,
  workflows = [],
  projectId,
  onContinue,
}: {
  task?: Task;
  onInspect: () => void;
  workflows?: {
    id: string;
    projectId: string;
    design: Record<string, unknown> | null;
  }[];
  projectId?: string;
  onContinue?: (text: string, focus?: TaskFocus) => void;
}) {
  if (!task) return null;
  const layout = layoutFromTask(task);
  const sources = [...new Set(task.events.flatMap((event) => event.sources))]
    .map(safeSource)
    .filter((value): value is string => !!value);
  const steps = progressSteps(task);
  const twinPanel = task.events.map((event) => event.result).find(isTwinPanel);
  const artifacts = artifactsForConversation(
    task,
    workflows,
    projectId || "",
  );
  if (
    !sources.length &&
    !artifacts.length &&
    !twinPanel &&
    !layout &&
    !steps.length
  )
    return null;
  const specOnly = taskKeptSpecOnly(task);
  const done = studentProcessDone(task, steps);
  return (
    <div className="visual-message">
      {layout && <PlanformStage layout={layout} />}
      {!!steps.length && (
        <button className="tool-result-summary" onClick={onInspect}>
          {done ? (
            <Check size={15} />
          ) : specOnly ? (
            <CircleHelp size={15} />
          ) : (
            <Circle size={15} />
          )}
          {visualProcessCaption(task, steps)}
        </button>
      )}
      {artifacts.map((item) => (
        <ArtifactStage
          key={item.id}
          design={item.design}
          continueId={item.id}
          onContinue={onContinue}
        />
      ))}
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
    </div>
  );
}
