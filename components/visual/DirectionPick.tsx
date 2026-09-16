"use client";

import { Sparkles } from "lucide-react";
import type { DirectionSetView } from "@/lib/client/direction-result";

export default function DirectionPick({
  workflow,
  onPick,
}: {
  workflow: DirectionSetView;
  onPick?: (workflowId: string, index: number, title: string) => void;
}) {
  const waiting = workflow.state === "awaiting_selection" && workflow.selected == null;
  const chosen =
    workflow.selected != null ? workflow.directions[workflow.selected] : null;
  return (
    <section className="direction-pick" aria-label="創作方向">
      <p className="eyebrow">創作 · 方向</p>
      <h2>{waiting ? "選一個方向" : chosen ? chosen.title : "創作方向"}</h2>
      <ul className="pattern-rail" aria-label="可選方向">
        {workflow.directions.map((direction, index) => {
          const selected = workflow.selected === index;
          return (
            <li key={direction.title + index}>
              <article
                className="pattern-card"
                data-selected={selected ? "true" : undefined}
              >
                <Sparkles size={18} aria-hidden="true" />
                <h3>{direction.title}</h3>
                <p>{direction.claim || direction.visual || "視覺方向"}</p>
                {waiting && onPick && (
                  <button
                    type="button"
                    onClick={() =>
                      onPick(
                        workflow.id,
                        index,
                        direction.title,
                      )
                    }
                  >
                    用這個方向
                  </button>
                )}
              </article>
            </li>
          );
        })}
      </ul>
      <p className="quiet">
        {waiting
          ? "選定後才會製作，不是已發佈。"
          : "已選定方向。製作結果會出現在下方預覽。"}
      </p>
    </section>
  );
}
