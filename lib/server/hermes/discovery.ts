import { normalizeBaseUrl, HERMES_DEFAULTS } from "../integrations/truth-status";
import { validateSsrfSafeUrl } from "../security.ts";
import { listAgentProfiles } from "./registry.ts";
import {
  listHermesNamedProfiles,
  resolveHermesTarget,
  type FeatureState,
} from "./target.ts";

export interface HermesEndpointProbe {
  path: string;
  state: FeatureState;
  httpStatus: number | null;
}

export interface HermesCapabilityReport {
  online: boolean;
  latencyMs: number;
  models: string[];
  activeModel: string;
  availableProfiles: { id: string; name: string; icon: string; kind?: string }[];
  hermesProfiles: ReturnType<typeof listHermesNamedProfiles>;
  features: Record<string, FeatureState>;
  endpoints: HermesEndpointProbe[];
  degradedFallback: boolean;
  message: string;
  profileResolution?: ReturnType<typeof resolveHermesTarget>;
}

async function classifyEndpoint(
  base: string,
  path: string,
  key: string,
): Promise<HermesEndpointProbe> {
  try {
    const res = await fetch(`${base}${path}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    }).catch(() => null);

    if (!res) return { path, state: "failed", httpStatus: null };
    await res.body?.cancel().catch(() => {});
    if (res.ok) return { path, state: "available", httpStatus: res.status };
    if (res.status === 404) return { path, state: "unsupported", httpStatus: 404 };
    if (res.status === 401 || res.status === 403 || res.status === 405 || res.status === 429) {
      return { path, state: "partial", httpStatus: res.status };
    }
    if (res.status >= 500) return { path, state: "failed", httpStatus: res.status };
    return { path, state: "unknown", httpStatus: res.status };
  } catch {
    return { path, state: "failed", httpStatus: null };
  }
}

function emptyFeatures(): Record<string, FeatureState> {
  return {
    health: "unknown",
    models: "unknown",
    capabilities: "unknown",
    skills: "unknown",
    toolsets: "unknown",
    runs: "unknown",
    sessions: "unknown",
    image: "unknown",
  };
}

export async function probeHermesCapabilities(
  rawUrl?: string,
  apiKey?: string,
  profileId?: string,
): Promise<HermesCapabilityReport> {
  const start = Date.now();
  const resolved = resolveHermesTarget(profileId);
  const consoleProfiles = listAgentProfiles().map((p) => ({
    id: p.id,
    name: p.name,
    icon: p.icon,
    kind: p.kind || "console_role",
  }));
  const hermesProfiles = listHermesNamedProfiles();
  const features = emptyFeatures();

  const base = normalizeBaseUrl(rawUrl || resolved.baseUrl || process.env.HERMES_API_URL || "");
  const key = (
    apiKey ||
    process.env[resolved.credentialReference] ||
    process.env.HERMES_API_KEY ||
    HERMES_DEFAULTS.DEFAULT_API_KEY
  ).trim();

  const baseReport = {
    availableProfiles: consoleProfiles,
    hermesProfiles,
    profileResolution: resolved,
  };

  if (!base) {
    return {
      ...baseReport,
      online: false,
      latencyMs: 0,
      models: [HERMES_DEFAULTS.DEFAULT_MODEL],
      activeModel: HERMES_DEFAULTS.DEFAULT_MODEL,
      features,
      endpoints: [],
      degradedFallback: true,
      message: "未設定 Hermes 網域，系統處於本地沙盒模式。Console roles 不是 live /p/<profile>。",
    };
  }

  const ssrf = validateSsrfSafeUrl(base, true);
  if (!ssrf.safe) {
    return {
      ...baseReport,
      online: false,
      latencyMs: 0,
      models: [HERMES_DEFAULTS.DEFAULT_MODEL],
      activeModel: HERMES_DEFAULTS.DEFAULT_MODEL,
      features,
      endpoints: [],
      degradedFallback: true,
      message: `網址不安全: ${ssrf.reason}`,
    };
  }

  const paths = [
    "/health",
    "/v1/models",
    "/v1/capabilities",
    "/v1/skills",
    "/v1/toolsets",
    "/v1/runs",
    "/api/sessions",
  ] as const;

  const endpoints = await Promise.all(paths.map((path) => classifyEndpoint(base, path, key)));
  const byPath = Object.fromEntries(endpoints.map((item) => [item.path, item]));

  features.health = byPath["/health"]?.state || "unknown";
  features.models = byPath["/v1/models"]?.state || "unknown";
  features.capabilities = byPath["/v1/capabilities"]?.state || "unknown";
  features.skills = byPath["/v1/skills"]?.state || "unknown";
  features.toolsets = byPath["/v1/toolsets"]?.state || "unknown";
  features.runs = byPath["/v1/runs"]?.state || "unknown";
  features.sessions = byPath["/api/sessions"]?.state || "unknown";
  features.image =
    process.env.HERMES_IMAGE_INPUT === "true"
      ? features.capabilities === "available"
        ? "partial"
        : "unknown"
      : "unsupported";

  let models = [HERMES_DEFAULTS.DEFAULT_MODEL];
  const modelsProbe = byPath["/v1/models"];
  if (modelsProbe?.state === "available") {
    try {
      const res = await fetch(`${base}/v1/models`, {
        method: "GET",
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(3000),
      });
      const data = await res.json().catch(() => ({}));
      if (Array.isArray((data as { data?: { id: string }[] }).data)) {
        models = (data as { data: { id: string }[] }).data.map((m) => m.id);
      }
    } catch {
      features.models = "partial";
    }
  }

  const online =
    features.health === "available" || features.models === "available";
  const lastStatus =
    modelsProbe?.httpStatus || byPath["/health"]?.httpStatus || endpoints.find((e) => e.httpStatus)?.httpStatus;
  const statusNote = lastStatus ? ` (HTTP ${lastStatus})` : "";

  return {
    ...baseReport,
    online,
    latencyMs: Date.now() - start,
    models,
    activeModel: models[0] || HERMES_DEFAULTS.DEFAULT_MODEL,
    features,
    endpoints,
    degradedFallback: !online,
    message: online
      ? features.models === "available"
        ? "Hermes API Server 已通過 /v1/models 探測。"
        : "Hermes /health 可用；/v1/models 尚未驗證。"
      : `無法確認 Hermes API Server${statusNote}。未實作的端點標記 unsupported，不是假 online。`,
  };
}
