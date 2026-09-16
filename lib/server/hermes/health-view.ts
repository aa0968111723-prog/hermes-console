import type { DiscoveryItem, Health } from "../../contracts";
import { redact } from "../security";

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
  const message = redact(state.message);
  if (operator) {
    return {
      ...state,
      message,
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
    message,
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
