import type { DiscoveryItem, Health } from "../../contracts";
import { redact } from "../security";
import {
  STUDENT_HERMES_UNCONFIGURED,
  studentHermesError,
} from "../errors";

/** Member/public connection copy. Operators keep the probe's own message. */
export function studentConnectionMessage(
  state: Pick<Health, "credential" | "status" | "message">,
): string {
  if (
    state.credential === "missing" ||
    state.credential === "invalid" ||
    state.status === "unconfigured"
  )
    return STUDENT_HERMES_UNCONFIGURED;
  if (state.status === "verifying") return "正在確認連線。";
  if (state.status === "failed") return studentHermesError(state.message);
  return studentHermesError(state.message);
}

function presentDiscovery(items: DiscoveryItem[]): DiscoveryItem[] {
  return items.map((item) => ({
    ...item,
    name: redact(item.name),
    description: redact(item.description || ""),
    tools: (item.tools || []).map((tool) => redact(tool)),
  }));
}

/** Public/member health is a probe. Tool names and vault/env sources stay operator-only. */
export function presentHealth(state: Health, operator: boolean): Health {
  if (operator) {
    return {
      ...state,
      message: redact(state.message),
      models: state.models.map((id) => redact(id)),
      skills: presentDiscovery(state.skills),
      toolsets: presentDiscovery(state.toolsets),
    };
  }
  return {
    checkedAt: state.checkedAt,
    reachable: state.reachable,
    credential: state.credential,
    agent: state.agent,
    status: state.status,
    message: studentConnectionMessage(state),
    httpStatus: null,
    features: {},
    models: [],
    skills: [],
    toolsets: [],
    discovery: {},
    backend: state.backend,
    dataDir: state.dataDir,
    storeReady: state.storeReady,
  };
}
