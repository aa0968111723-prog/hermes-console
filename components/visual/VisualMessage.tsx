import { ExternalLink, Search, Check, Circle, CircleHelp } from "lucide-react";
import type { Task, TaskFocus } from "@/lib/contracts";
import {
  artifactsForConversation,
  progressSteps,
  safeSource,
  studentHonestyLabel,
  studentProcessDone,
  visualProcessCaption,
} from "@/lib/client/activity";
import FirstReactionBoard from "../audience/FirstReactionBoard";
import {
  isInspirationSearchPack,
  type InspirationSearchPack,
} from "@/lib/inspiration-pack";
import { isImageReviewPack, twinPanelFromResults } from "@/lib/image-review";
import { isClubKnowledgePack } from "@/lib/knowledge-pack";
import InspirationResult from "./InspirationResult";
import ImageReviewResult from "./ImageReviewResult";
import KnowledgeResult from "./KnowledgeResult";
import { layoutFromTask } from "@/lib/client/planform-layout";
import PlanformStage from "./PlanformStage";
import ArtifactStage from "./ArtifactStage";
import { continueDesign } from "@/lib/client/artifacts";

export default function VisualMessage({
  task,
  onInspect,
  onPickInspiration,
  pickingInspiration = false,
  selectedInspiration = null,
  workflows = [],
  projectId,
  onContinue,
}: {
  task?: Task;
  onInspect: () => void;
  onPickInspiration?: (
    id: "A" | "B" | "C",
    pack: InspirationSearchPack,
  ) => void;
  pickingInspiration?: boolean;
  selectedInspiration?: "A" | "B" | "C" | null;
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
  const results = task.events.map((event) => event.result);
  const twinPanel = twinPanelFromResults(results);
  const imageReview = results.find(isImageReviewPack);
  const knowledge = results.find(isClubKnowledgePack);
  const inspiration = task.events
    .map((event) => event.result)
    .find(isInspirationSearchPack);
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
    !steps.length &&
    !inspiration &&
    !imageReview &&
    !knowledge
  )
    return null;
  const honesty = studentHonestyLabel(task);
  const done = studentProcessDone(task, steps);
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
      {knowledge && <KnowledgeResult pack={knowledge} />}
      {!!steps.length && !inspiration && !imageReview && !knowledge && (
        <button className="tool-result-summary" onClick={onInspect}>
          {done ? (
            <Check size={15} />
          ) : honesty ? (
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
          onContinue={
            onContinue
              ? () => {
                  const next = continueDesign(item.id);
                  onContinue(next.text, next.focus);
                }
              : undefined
          }
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
