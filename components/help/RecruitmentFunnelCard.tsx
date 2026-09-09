"use client";

import { useEffect, useState } from "react";
import type { FunnelLane, FunnelStageStatus } from "@/lib/contracts";
import {
  FUNNEL_FOLD_SUMMARY,
  FUNNEL_UNAVAILABLE_COPY,
  fetchRecruitmentFunnel,
  skeletonStages,
  type FunnelStageView,
  type FunnelUiState,
} from "@/lib/client/recruitment-funnel";

function statusTone(status: FunnelStageStatus): string {
  switch (status) {
    case "wired_ok":
      return "ok";
    case "wired_redacted":
      return "redacted";
    case "degraded":
      return "degraded";
    case "missing":
      return "missing";
    default:
      return "unknown";
  }
}

function laneTone(lane: FunnelLane): string {
  switch (lane) {
    case "FACT":
      return "fact";
    case "INSPIRATION":
      return "inspiration";
    case "redacted":
      return "redacted";
    default:
      return "none";
  }
}

function StageRow({ stage }: { stage: FunnelStageView }) {
  return (
    <li className="funnel-stage-row" data-stage={stage.id} data-status={stage.status} data-lane={stage.lane}>
      <span
        className={`funnel-status-dot funnel-status-dot--${statusTone(stage.status)}`}
        aria-hidden="true"
      />
      <span className="funnel-stage-id">
        <strong>{stage.label}</strong>
        <small>{stage.id}</small>
      </span>
      <span className="funnel-status-label">{stage.statusLabel}</span>
      <span className={`funnel-lane-chip funnel-lane-chip--${laneTone(stage.lane)}`}>
        {stage.laneLabel}
      </span>
      {stage.notes ? <span className="funnel-stage-notes">{stage.notes}</span> : null}
    </li>
  );
}

function FunnelStagesList({
  state,
}: {
  state: FunnelUiState;
}) {
  const stages = state.kind === "loading" ? skeletonStages() : state.stages;
  const unavailable = state.kind === "unavailable";
  return (
    <div className="funnel-stages-block">
      {unavailable ? (
        <p className="funnel-unavailable" role="status">
          {FUNNEL_UNAVAILABLE_COPY}
        </p>
      ) : null}
      <ul
        className={`funnel-stages-list${state.kind === "loading" ? " funnel-stages-list--skeleton" : ""}`}
        aria-busy={state.kind === "loading" ? true : undefined}
      >
        {stages.map((stage) => (
          <StageRow key={stage.id} stage={stage} />
        ))}
      </ul>
    </div>
  );
}

function useFunnelState(): FunnelUiState {
  const [state, setState] = useState<FunnelUiState>({ kind: "loading" });
  useEffect(() => {
    let cancelled = false;
    fetchRecruitmentFunnel().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

/** Primary Help / 招生·知識 small card — five stages status + lane only. */
export default function RecruitmentFunnelCard() {
  const state = useFunnelState();
  return (
    <article className="funnel-readonly-card" aria-label="招生漏斗五階狀態">
      <p className="eyebrow">招生·知識</p>
      <h3>漏斗五階</h3>
      <p className="muted funnel-readonly-hint">
        只讀狀態與 lane；靈感表（INSPIRATION）作文宣參考，不是名單。不顯示人數。
      </p>
      <FunnelStagesList state={state} />
    </article>
  );
}

/** Optional Inspiration soft-notice fold — default collapsed, summary 漏斗五階. */
export function RecruitmentFunnelFold() {
  const state = useFunnelState();
  return (
    <details className="funnel-readonly-fold">
      <summary className="funnel-readonly-fold-summary">{FUNNEL_FOLD_SUMMARY}</summary>
      <FunnelStagesList state={state} />
    </details>
  );
}
