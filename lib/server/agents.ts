import type { DiscoveryItem, Health } from "../contracts";
import { WORKSPACE_OWNER } from "./security";
import { list, put } from "./store";

export type AgentRole =
  | "general"
  | "creative"
  | "research"
  | "tku"
  | "design"
  | "social"
  | "development"
  | "reviewer";

export type CapabilityState =
  | "unknown"
  | "unsupported"
  | "available"
  | "partial"
  | "failed";

export interface AgentProfile {
  id: string;
  name: string;
  displayName: string;
  description: string;
  baseUrl: string;
  profilePath: string;
  credentialReference: string;
  model: string | null;
  status: "unconfigured" | "configured" | "reachable" | "failed";
  reachable: boolean | null;
  capabilities: Record<string, CapabilityState>;
  tools: string[];
  skills: DiscoveryItem[];
  toolsets: DiscoveryItem[];
  memorySupport: CapabilityState;
  sessionSupport: CapabilityState;
  runsSupport: CapabilityState;
  usage: { totalTokens: number | null; durationMs: number | null };
  lastVerifiedAt: string | null;
  lastError: string | null;
  enabled: boolean;
  role: AgentRole;
  tags: string[];
}

const ROLE_META: Record<
  AgentRole,
  { displayName: string; description: string }
> = {
  general: { displayName: "主代理", description: "理解需求並調度其他代理。" },
  research: { displayName: "研究代理", description: "搜尋與整理真實來源。" },
  creative: { displayName: "創意代理", description: "提出策略層創作方向。" },
  tku: { displayName: "淡江代理", description: "淡江／淡水真實資料研究。" },
  design: { displayName: "設計代理", description: "Canva 草稿與修訂。" },
  social: { displayName: "社群代理", description: "IG 文案草稿與靈感整理。" },
  development: { displayName: "開發代理", description: "專案工具與 MCP 接線。" },
  reviewer: { displayName: "評測代理", description: "Audience Twin 反向評測。" },
};

export function credentialReferenceFor(role: AgentRole) {
  return role === "general"
    ? "HERMES_API_KEY"
    : `HERMES_${role.toUpperCase()}_API_KEY`;
}

export function urlReferenceFor(role: AgentRole) {
  return role === "general"
    ? "HERMES_API_URL"
    : `HERMES_${role.toUpperCase()}_API_URL`;
}

function env(name: string) {
  return (process.env[name] || "").trim();
}

export function profilePathFromUrl(url: string) {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/^\/p\/([a-zA-Z0-9_-]+)\/?$/);
    return match ? "/p/" + match[1] : "";
  } catch {
    return "";
  }
}

export function emptyCapabilities(): Record<string, CapabilityState> {
  return {
    models: "unknown",
    capabilities: "unknown",
    skills: "unknown",
    toolsets: "unknown",
    chat: "unknown",
    runs: "unknown",
    sessions: "unknown",
    toolEvents: "unknown",
    memory: "unknown",
    usage: "unknown",
    imageInput: "unknown",
    serverState: "unknown",
  };
}

export function capabilityFromHealth(
  health: Health,
): Record<string, CapabilityState> {
  const features = health.features || {};
  const flag = (value: unknown, fallback: CapabilityState): CapabilityState =>
    value === true ? "available" : value === false ? "unsupported" : fallback;
  const states = emptyCapabilities();
  if (health.status === "unconfigured") return states;
  if (health.status === "failed") {
    for (const key of Object.keys(states)) states[key] = "failed";
    return states;
  }
  states.models = health.models.length ? "available" : "failed";
  states.capabilities = Object.keys(features).length
    ? "available"
    : "unsupported";
  states.skills = health.skills.length ? "available" : "unsupported";
  states.toolsets = health.toolsets.length ? "available" : "unsupported";
  states.chat = "available";
  states.runs = flag(features.run_submission, "unsupported");
  if (features.run_submission && !features.run_status) states.runs = "partial";
  states.sessions = flag(
    features.session_resources ?? features.sessions,
    "unsupported",
  );
  states.toolEvents = flag(features.run_events_sse, "unsupported");
  states.memory = flag(
    features.memory || features.session_search || features.memory_provider,
    "unsupported",
  );
  states.usage = "partial";
  states.imageInput =
    process.env.HERMES_IMAGE_INPUT === "true" ? "available" : "unsupported";
  states.serverState = flag(features.server_side_state, "unknown");
  return states;
}

export function defaultProfiles(): AgentProfile[] {
  return (Object.keys(ROLE_META) as AgentRole[]).map((role) => {
    const urlRef = urlReferenceFor(role);
    const keyRef = credentialReferenceFor(role);
    const baseUrl = env(urlRef) || (role === "general" ? env("HERMES_API_URL") : "");
    const keyPresent = !!(env(keyRef) || (role === "general" && env("HERMES_API_KEY")));
    const configured = !!(baseUrl && keyPresent);
    return {
      id: role,
      name: role,
      displayName: ROLE_META[role].displayName,
      description: ROLE_META[role].description,
      baseUrl,
      profilePath: profilePathFromUrl(baseUrl),
      credentialReference: keyRef,
      model: role === "general" ? process.env.HERMES_MODEL || "hermes-agent" : null,
      status: configured ? "configured" : "unconfigured",
      reachable: null,
      capabilities: emptyCapabilities(),
      tools: [],
      skills: [],
      toolsets: [],
      memorySupport: "unknown",
      sessionSupport: "unknown",
      runsSupport: "unknown",
      usage: { totalTokens: null, durationMs: null },
      lastVerifiedAt: null,
      lastError: configured ? null : "尚未設定此代理的後端網域與憑證參照。",
      enabled: configured || role === "general",
      role,
      tags: [role],
    };
  });
}

export function publicProfile(profile: AgentProfile): AgentProfile {
  let baseUrl = "";
  try {
    if (profile.baseUrl)
      baseUrl = new URL(profile.baseUrl).origin + profile.profilePath;
  } catch {
    baseUrl = "";
  }
  return { ...profile, baseUrl };
}

export function listAgents(): AgentProfile[] {
  const stored = list<AgentProfile>("agent_profile", WORKSPACE_OWNER);
  const defaults = defaultProfiles();
  return defaults.map((profile) => {
    const existing = stored.find((item) => item.id === profile.id);
    return existing ? { ...profile, ...existing, credentialReference: profile.credentialReference } : profile;
  });
}

export function saveAgentDiscovery(id: string, patch: Partial<AgentProfile>) {
  const current = listAgents().find((item) => item.id === id);
  if (!current) return null;
  const next = { ...current, ...patch, id, credentialReference: current.credentialReference };
  return put("agent_profile", WORKSPACE_OWNER, next);
}

export function brainVisible(profile: AgentProfile) {
  return (
    profile.memorySupport === "available" ||
    profile.sessionSupport === "available" ||
    profile.capabilities.memory === "available" ||
    profile.capabilities.sessions === "available"
  );
}
