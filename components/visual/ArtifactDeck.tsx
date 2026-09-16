"use client";
import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Workflow } from "@/lib/server/workflows";
import type { Artifact } from "@/lib/server/artifacts";
import ArtifactStage from "./ArtifactStage";
import { isDirectionBriefPack } from "@/lib/direction-brief";
import { workflowPreviewDesign } from "@/lib/client/workflow-state";
export default function ArtifactDeck({
  items,
  artifacts = [],
  onContinue,
  onRestore,
  onFork,
}: {
  items: Workflow[];
  artifacts?: Artifact[];
  onContinue: (id: string) => void;
  onRestore?: (artifactId: string, revisionId: string) => void;
  onFork?: (artifactId: string) => void;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const linked = new Set(
    items.map((item) => item.artifactId).filter(Boolean) as string[],
  );
  const standalone = artifacts.filter(
    (item) =>
      item.source !== "copy" &&
      item.source !== "material" &&
      !linked.has(item.id),
  );
  const designs = [
    ...items
      .filter((w) => !!w.design || isDirectionBriefPack(w.directionBrief))
      .map((w) => ({
        key: w.id,
        design: workflowPreviewDesign(w) || { ...w.directionBrief! },
        workflowId: w.id,
        artifact: artifacts.find(
          (item) => item.id === w.artifactId || item.workflowId === w.id,
        ),
      })),
    ...standalone.map((artifact) => ({
      key: artifact.id,
      design: (artifact.revisions.find(
        (item) => item.revisionId === artifact.currentRevisionId,
      ) || artifact.revisions.at(-1))!.design,
      workflowId: artifact.id,
      artifact,
    })),
  ];
  if (!designs.length) return null;
  const move = (direction: number) =>
    rail.current?.scrollBy({
      left: direction * rail.current.clientWidth,
      behavior:
        matchMedia("(prefers-reduced-motion: reduce)").matches ||
        rail.current.closest('[data-spatial="static"]')
          ? "instant"
          : "smooth",
    });
  return (
    <section className="artifact-deck" aria-label="專案作品">
      <header>
        <h2>
          作品 <small>{designs.length}</small>
        </h2>
        {designs.length > 1 && (
          <div>
            <button aria-label="上一件作品" onClick={() => move(-1)}>
              <ChevronLeft size={22} />
            </button>
            <button aria-label="下一件作品" onClick={() => move(1)}>
              <ChevronRight size={22} />
            </button>
          </div>
        )}
      </header>
      <div
        className="artifact-rail"
        ref={rail}
        role="group"
        aria-label="左右滑動查看作品"
        tabIndex={0}
      >
        {designs.map((item) => (
          <ArtifactStage
            key={item.key}
            design={item.design}
            artifact={item.artifact}
            onContinue={() => onContinue(item.workflowId)}
            onRestore={
              item.artifact && onRestore
                ? (revisionId) => onRestore(item.artifact!.id, revisionId)
                : undefined
            }
            onFork={
              item.artifact && onFork
                ? () => onFork(item.artifact!.id)
                : undefined
            }
          />
        ))}
      </div>
    </section>
  );
}
