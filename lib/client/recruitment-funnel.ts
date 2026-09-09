/** P0′ client — recruitment funnel read-only UI helpers (no PII / counts omitted from UI model). */

import type {
  FunnelLane,
  FunnelStageId,
  FunnelStageStatus,
  RecruitmentFunnelRead,
  RecruitmentFunnelStage,
} from "@/lib/contracts";

export const FUNNEL_STAGE_IDS: readonly FunnelStageId[] = [
  "forms",
  "sheets",
  "roster",
  "funnel",
  "attendance",
] as const;

export const FUNNEL_STAGE_LABEL: Record<FunnelStageId, string> = {
  forms: "表單",
  sheets: "靈感表",
  roster: "名單",
  funnel: "漏斗",
  attendance: "出席",
};

/** Soft lane chip copy — sheets stays INSPIRATION (never imply roster). */
export const FUNNEL_LANE_LABEL: Record<FunnelLane, string> = {
  FACT: "FACT",
  INSPIRATION: "INSPIRATION",
  redacted: "redacted",
  none: "none",
};

export const FUNNEL_STATUS_LABEL: Record<FunnelStageStatus, string> = {
  wired_ok: "已接線",
  wired_redacted: "已脫敏",
  missing: "缺",
  degraded: "暫不可用",
  unknown: "未知",
};

export const FUNNEL_UNAVAILABLE_COPY = "狀態暫不可用";

export const FUNNEL_FOLD_SUMMARY = "漏斗五階";

/** UI-safe stage view: status + lane + optional notes only. */
export type FunnelStageView = {
  id: FunnelStageId;
  label: string;
  status: FunnelStageStatus;
  statusLabel: string;
  lane: FunnelLane;
  laneLabel: string;
  notes?: string;
};

export type FunnelUiState =
  | { kind: "loading" }
  | { kind: "unavailable"; stages: FunnelStageView[] }
  | { kind: "ready"; stages: FunnelStageView[]; degraded: boolean };

function stageView(stage: RecruitmentFunnelStage): FunnelStageView {
  const view: FunnelStageView = {
    id: stage.id,
    label: FUNNEL_STAGE_LABEL[stage.id],
    status: stage.status,
    statusLabel: FUNNEL_STATUS_LABEL[stage.status],
    lane: stage.lane,
    laneLabel: FUNNEL_LANE_LABEL[stage.lane],
  };
  if (stage.notes) view.notes = stage.notes;
  return view;
}

/** Skeleton rows when fetch fails or response is unusable — never fake wired_ok. */
export function skeletonStages(): FunnelStageView[] {
  return FUNNEL_STAGE_IDS.map((id) => ({
    id,
    label: FUNNEL_STAGE_LABEL[id],
    status: "unknown" as const,
    statusLabel: FUNNEL_STATUS_LABEL.unknown,
    lane: "none" as const,
    laneLabel: FUNNEL_LANE_LABEL.none,
  }));
}

/**
 * Map API payload → UI state.
 * degraded / missing statuses preserved; never promote to wired_ok.
 * Drops pathKeys, inspirationSheets counters, redaction blobs from render model.
 */
export function toFunnelUiState(payload: unknown): FunnelUiState {
  if (!payload || typeof payload !== "object") {
    return { kind: "unavailable", stages: skeletonStages() };
  }
  const read = payload as Partial<RecruitmentFunnelRead>;
  if (!Array.isArray(read.stages) || read.stages.length === 0) {
    return { kind: "unavailable", stages: skeletonStages() };
  }
  const byId = new Map(
    read.stages
      .filter((s): s is RecruitmentFunnelStage => !!s && typeof s === "object" && "id" in s)
      .map((s) => [s.id, s]),
  );
  const stages = FUNNEL_STAGE_IDS.map((id) => {
    const raw = byId.get(id);
    if (!raw) {
      return {
        id,
        label: FUNNEL_STAGE_LABEL[id],
        status: "unknown" as const,
        statusLabel: FUNNEL_STATUS_LABEL.unknown,
        lane: "none" as const,
        laneLabel: FUNNEL_LANE_LABEL.none,
      };
    }
    return stageView(raw);
  });
  if (read.degraded === true) {
    return { kind: "unavailable", stages };
  }
  return { kind: "ready", stages, degraded: false };
}

export async function fetchRecruitmentFunnel(): Promise<FunnelUiState> {
  try {
    const response = await fetch("/api/recruitment/funnel", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      return { kind: "unavailable", stages: skeletonStages() };
    }
    const data = await response.json().catch(() => null);
    return toFunnelUiState(data);
  } catch {
    return { kind: "unavailable", stages: skeletonStages() };
  }
}
