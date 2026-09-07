"use client";

import { useEffect, useRef } from "react";
import Turtle from "../Turtle";
import type { Task } from "@/lib/contracts";

export default function HermesCore({ task, offline, animation, size, onClick }: {
  task?: Task;
  offline: boolean;
  animation: boolean;
  size: number;
  onClick: () => void;
}) {
  const core = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = core.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const onMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const rect = el.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - .5;
      const y = (event.clientY - rect.top) / rect.height - .5;
      el.style.setProperty("--core-rx", `${Math.max(-2, Math.min(2, -y * 4))}deg`);
      el.style.setProperty("--core-ry", `${Math.max(-3, Math.min(3, x * 6))}deg`);
    };
    const reset = () => { el.style.setProperty("--core-rx", "0deg"); el.style.setProperty("--core-ry", "0deg"); };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", reset);
    return () => { el.removeEventListener("pointermove", onMove); el.removeEventListener("pointerleave", reset); };
  }, []);
  return (
    <div className="hermes-core" ref={core} data-task-state={task?.state || (offline ? "offline" : "idle")}>
      <span className="core-orbit core-orbit-one" aria-hidden="true" />
      <span className="core-orbit core-orbit-two" aria-hidden="true" />
      <span className="core-glow" aria-hidden="true" />
      <Turtle task={task} offline={offline} animation={animation} size={size} onClick={onClick} />
    </div>
  );
}
