"use client";
import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Workflow } from "@/lib/server/workflows";
import ArtifactStage from "./ArtifactStage";
export default function ArtifactDeck({
  items,
  onContinue,
}: {
  items: Workflow[];
  onContinue: (id: string) => void;
}) {
  const rail = useRef<HTMLDivElement>(null),
    designs = items.filter((w) => !!w.design);
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
        {designs.map((w) => (
          <ArtifactStage
            key={w.id}
            design={w.design!}
            onContinue={() => onContinue(w.id)}
          />
        ))}
      </div>
    </section>
  );
}
