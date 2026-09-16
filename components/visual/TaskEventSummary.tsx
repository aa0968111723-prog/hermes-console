"use client";
import {
  Brain,
  ChevronDown,
  Circle,
  Folder,
  Palette,
  Search,
  Users,
  Wrench,
} from "lucide-react";
import type { TaskEvent } from "@/lib/contracts";
import {
  activityKind,
  eventState,
  eventStateLabel,
  eventUserResult,
  toolDisplayLabel,
} from "@/lib/client/activity";
import MessageBody from "../MessageBody";

const icons = {
  request: Circle,
  research: Search,
  creative: Palette,
  audience: Users,
  memory: Brain,
  workspace: Folder,
  tool: Wrench,
};

export default function TaskEventSummary({ event }: { event: TaskEvent }) {
  const kind = activityKind(event.toolName);
  const Icon = icons[kind];
  const tool = toolDisplayLabel(event.toolName) || "任務";
  return (
    <summary className="event-summary">
      <span className="event-heading">
        <span
          className="event-tool-label"
          data-activity={kind}
          title={event.toolName ? `技術名稱：${event.toolName}` : undefined}
        >
          <Icon size={15} aria-hidden="true" />
          {tool}
        </span>
        <span className="event-state-label" data-state={eventState(event)}>
          {eventStateLabel(event)}
        </span>
        <ChevronDown className="event-chevron" size={17} aria-hidden="true" />
      </span>
      <span className="event-description">{event.summary}</span>
    </summary>
  );
}

/** User-facing text only. Tool JSON stays behind 原始結果. */
export function EventResult({ result }: { result: unknown }) {
  const shown = eventUserResult(result);
  if (!shown.text && !shown.technical) return null;
  return (
    <>
      {shown.text && <MessageBody text={shown.text} />}
      {shown.technical && (
        <details className="event-result-raw">
          <summary>原始結果</summary>
          <pre>{shown.technical}</pre>
        </details>
      )}
    </>
  );
}
