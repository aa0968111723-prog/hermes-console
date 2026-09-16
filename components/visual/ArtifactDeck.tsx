"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Workflow } from "@/lib/server/workflows";
import type { Artifact } from "@/lib/server/artifacts";
import ArtifactStage from "./ArtifactStage";
export default function ArtifactDeck({
  items,
  projectId,
  onContinue,
}: {
  items: Workflow[];
  projectId: string;
  onContinue: (text: string) => void;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const [copies, setCopies] = useState<Artifact[]>([]);
  const designs = items.filter((workflow) => !!workflow.design);
  useEffect(() => {
    let gone = false;
    fetch("/api/artifacts?projectId=" + encodeURIComponent(projectId), {
      credentials: "same-origin",
      cache: "no-store",
    })
      .then((response) => (response.ok ? response.json() : { artifacts: [] }))
      .then((data: { artifacts?: Artifact[] }) => {
        if (!gone)
          setCopies(
            (data.artifacts || []).filter((row) => row.source === "copy"),
          );
      })
      .catch(() => {
        if (!gone) setCopies([]);
      });
    return () => {
      gone = true;
    };
  }, [projectId, items.length]);
  if (!designs.length && !copies.length) return null;
  const move = (direction: number) =>
    rail.current?.scrollBy({
      left: direction * rail.current.clientWidth,
      behavior:
        matchMedia("(prefers-reduced-motion: reduce)").matches ||
        rail.current.closest('[data-spatial="static"]')
          ? "instant"
          : "smooth",
    });
  const count = designs.length + copies.length;
  return (
    <section className="artifact-deck" aria-label="專案作品">
      <header>
        <h2>
          作品 <small>{count}</small>
        </h2>
        {count > 1 && (
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
        {designs.map((workflow) => (
          <ArtifactStage
            key={workflow.id}
            design={workflow.design!}
            continueId={workflow.id}
            onContinue={onContinue}
          />
        ))}
        {copies.map((item) => (
          <ArtifactStage
            key={item.artifactId}
            artifact={item}
            onContinue={onContinue}
          />
        ))}
      </div>
    </section>
  );
}
