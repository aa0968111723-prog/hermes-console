"use client";
import {
  Check,
  CircleAlert,
  Circle,
  Search,
  Palette,
  Users,
  Brain,
  Folder,
  Wrench,
  LoaderCircle,
  Pause,
  Image as ImageIcon,
  Sparkles,
} from "lucide-react";
import type { Task } from "@/lib/contracts";
import {
  progressSteps,
  studentTaskLabel,
  taskKeptSpecOnly,
} from "@/lib/client/activity";

const icons: Record<string, typeof Search> = {
  理解: Brain,
  處理: Circle,
  看圖: ImageIcon,
  研究: Search,
  靈感: Sparkles,
  客群: Users,
  創作: Palette,
  完成: Circle,
  記憶: Brain,
  素材: Folder,
  工具: Wrench,
};

export default function AgentActivity({
  task,
  onInspect,
}: {
  task?: Task | null;
  onInspect?: () => void;
}) {
  if (!task) return null;
  const steps = progressSteps(task);
  return (
    <div
      className="agent-activity"
      aria-label="任務進度"
      data-task-state={task.state}
    >
      {steps.map((step) => {
        const Icon = icons[step.label] || Wrench;
        return (
          <span
            key={step.key}
            className={
              step.active
                ? "activity-active"
                : step.state === "completed"
                  ? "activity-complete"
                  : ["failed", "uncertain"].includes(step.state)
                    ? "activity-failed"
                    : ""
            }
            title={step.label}
          >
            <Icon size={15} aria-hidden="true" />
            {step.label}
            {step.state === "completed" && <Check size={12} aria-label="已完成" />}
            {["failed", "uncertain"].includes(step.state) && (
              <CircleAlert size={12} aria-label="失敗或待確認" />
            )}
          </span>
        );
      })}
      <button
        type="button"
        onClick={onInspect}
        disabled={!onInspect}
        className="activity-inspect"
        aria-label={"查看任務：" + studentTaskLabel(task)}
      >
        {taskKeptSpecOnly(task) ||
        ["failed", "uncertain"].includes(task.state) ? (
          <CircleAlert size={16} />
        ) : task.state === "completed" ? (
          <Check size={16} />
        ) : task.state === "running" ? (
          <LoaderCircle size={16} />
        ) : (
          <Pause size={16} />
        )}
        {studentTaskLabel(task)}
      </button>
    </div>
  );
}
