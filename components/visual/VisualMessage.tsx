import { ExternalLink, Search, Check, Circle } from "lucide-react";
import type { Task } from "@/lib/contracts";
import { eventState, highLevelProgress, safeSource } from "@/lib/client/activity";
import { isTwinPanel } from "@/lib/server/audience/personas";
import FirstReactionBoard from "../audience/FirstReactionBoard";
import { isInspirationSearchPack, type InspirationSearchPack } from "@/lib/inspiration-pack";
import { isImageReviewPack } from "@/lib/image-review";
import InspirationResult from "./InspirationResult";
import ImageReviewResult from "./ImageReviewResult";
import { layoutFromTask } from "@/lib/client/planform-layout";
import PlanformStage from "./PlanformStage";
export default function VisualMessage({
  task,
  onInspect,
  onPickInspiration,
  pickingInspiration = false,
  selectedInspiration = null,
}: {
  task?: Task;
  onInspect: () => void;
  onPickInspiration?: (
    id: "A" | "B" | "C",
    pack: InspirationSearchPack,
  ) => void;
  pickingInspiration?: boolean;
  selectedInspiration?: "A" | "B" | "C" | null;
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
  const imageReview = task.events
    .map((event) => event.result)
    .find(isImageReviewPack);
  const twinPanel =
    imageReview?.twinPanel ||
    task.events.map((event) => event.result).find(isTwinPanel);
  const inspiration = task.events
    .map((event) => event.result)
    .find(isInspirationSearchPack);
  const progress = highLevelProgress(task);
  if (
    !sources.length &&
    !calls.size &&
    !twinPanel &&
    !layout &&
    !inspiration &&
    !imageReview
  )
    return null;
  return (
    <div className="visual-message">
      {layout && <PlanformStage layout={layout} />}
      {inspiration && (
        <InspirationResult
          pack={inspiration}
          onSelect={
            onPickInspiration
              ? (id) => onPickInspiration(id, inspiration)
              : undefined
          }
          selectedId={selectedInspiration}
          busy={pickingInspiration}
        />
      )}
      {imageReview && <ImageReviewResult pack={imageReview} />}
      {!!calls.size && !inspiration && !imageReview && progress && (
        <button className="tool-result-summary" onClick={onInspect}>
          {completed === calls.size ? (
            <Check size={15} />
          ) : (
            <Circle size={15} />
          )}
          {completed === calls.size ? progress : "進行中"}
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
    </div>
  );
}
