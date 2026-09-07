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
} from "lucide-react";
import type { Task } from "@/lib/contracts";
import {
  activityKind,
  activityLabels,
  eventState,
  taskStateLabel,
  workingEvent,
} from "@/lib/client/activity";
const icons = {
  request: Circle,
  research: Search,
  creative: Palette,
  audience: Users,
  memory: Brain,
  workspace: Folder,
  tool: Wrench,
};

export default function AgentActivity({
  task,
  onInspect,
}: {
  task?: Task | null;
  onInspect?: () => void;
}) {
  if (!task) return null;
  const current = workingEvent(task);
  // Only steps with received events appear. Collapse updates of the same call.
  const calls = new Map<string, (typeof task.events)[number]>();
  for (const event of task.events)
    if (event.toolName) calls.set(event.toolCallId || event.toolName, event);
  const steps = [...calls.values()].slice(-4);
  return (
    <div
      className="agent-activity"
      aria-label="任務進度"
      data-task-state={task.state}
    >
      {steps.map((event) => {
        const kind = activityKind(event.toolName),
          Icon = icons[kind];
        const state = eventState(event);
        return (
          <span
            key={event.id}
            className={current?.id === event.id ? "activity-active" : ""}
            title={event.summary}
          >
            <Icon size={15} aria-hidden="true" />
            {activityLabels[kind]}
            {state === "completed" && <Check size={12} aria-label="已完成" />}
            {["failed", "uncertain"].includes(state) && (
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
        aria-label={"查看任務：" + taskStateLabel[task.state]}
      >
        {task.state === "completed" ? (
          <Check size={16} />
        ) : ["failed", "uncertain"].includes(task.state) ? (
          <CircleAlert size={16} />
        ) : task.state === "running" ? (
          <LoaderCircle size={16} />
        ) : (
          <Pause size={16} />
        )}
        {taskStateLabel[task.state]}
      </button>
    </div>
  );
}
