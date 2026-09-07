"use client";

import { Check, Circle, LoaderCircle, Search, Sparkles } from "lucide-react";
import type { Task } from "@/lib/contracts";

export default function AgentActivity({ task }: { task?: Task | null }) {
  const state = task?.state;
  const active = state === "running" || state === "queued" || state === "stopping";
  const failed = state === "failed" || state === "uncertain";
  return <div className="agent-activity" aria-label="任務進度">
    <span className={active ? "activity-active" : ""}><Circle size={10} fill={active ? "currentColor" : "none"} />理解</span>
    <i aria-hidden="true" />
    <span className={active ? "activity-active" : ""}><Search size={13} />研究</span>
    <i aria-hidden="true" />
    <span className={active ? "activity-active" : ""}><Sparkles size={13} />創作</span>
    <i aria-hidden="true" />
    <span className={failed ? "activity-failed" : state === "completed" ? "activity-complete" : ""}>{failed ? <Circle size={11} /> : state === "completed" ? <Check size={13} /> : <LoaderCircle size={13} />}<span className="sr-only">{failed ? "失敗" : state === "completed" ? "完成" : "等待"}</span></span>
  </div>;
}
