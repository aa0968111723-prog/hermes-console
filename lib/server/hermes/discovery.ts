import { normalizeBaseUrl, HERMES_DEFAULTS } from "../../hermes-config.ts";
import { validateSsrfSafeUrl } from "../security.ts";
import { listAgentProfiles } from "./registry.ts";

export interface HermesCapabilityReport {
  online: boolean;
  latencyMs: number;
  models: string[];
  activeModel: string;
  availableProfiles: { id: string; name: string; icon: string }[];
  degradedFallback: boolean;
  message: string;
}

export async function probeHermesCapabilities(
  rawUrl?: string,
  apiKey?: string
): Promise<HermesCapabilityReport> {
  const start = Date.now();
  const base = normalizeBaseUrl(rawUrl || process.env.HERMES_API_URL || "");
  const key = (apiKey || process.env.HERMES_API_KEY || HERMES_DEFAULTS.DEFAULT_API_KEY).trim();
  const profiles = listAgentProfiles().map((p) => ({ id: p.id, name: p.name, icon: p.icon }));

  if (!base) {
    return {
      online: false,
      latencyMs: 0,
      models: [HERMES_DEFAULTS.DEFAULT_MODEL],
      activeModel: HERMES_DEFAULTS.DEFAULT_MODEL,
      availableProfiles: profiles,
      degradedFallback: true,
      message: "未設定 Zeabur 網域，系統處於本地沙盒高擬真雙引擎模式"
    };
  }

  const ssrf = validateSsrfSafeUrl(base, true);
  if (!ssrf.safe) {
    return {
      online: false,
      latencyMs: 0,
      models: [HERMES_DEFAULTS.DEFAULT_MODEL],
      activeModel: HERMES_DEFAULTS.DEFAULT_MODEL,
      availableProfiles: profiles,
      degradedFallback: true,
      message: `網址不安全: ${ssrf.reason}`
    };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(`${base}/v1/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal
    }).catch(() => null);

    clearTimeout(timeout);
    const latencyMs = Date.now() - start;

    if (res && res.ok) {
      const data = await res.json().catch(() => ({}));
      const models = Array.isArray(data.data) ? data.data.map((m: { id: string }) => m.id) : [HERMES_DEFAULTS.DEFAULT_MODEL];
      return {
        online: true,
        latencyMs,
        models,
        activeModel: models[0] || HERMES_DEFAULTS.DEFAULT_MODEL,
        availableProfiles: profiles,
        degradedFallback: false,
        message: "Zeabur Hermes 雲端主腦連線正常"
      };
    }

    // 若 401 拒絕金鑰
    if (res && res.status === 401) {
      return {
        online: false,
        latencyMs,
        models: [HERMES_DEFAULTS.DEFAULT_MODEL],
        activeModel: HERMES_DEFAULTS.DEFAULT_MODEL,
        availableProfiles: profiles,
        degradedFallback: true,
        message: "Zeabur Hermes API 金鑰無效或需重新配置 (HTTP 401)，已轉入本地備援"
      };
    }

    // Ping 根路徑嘗試
    const ping = await fetch(base, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(3000)
    }).catch(() => null);

    if (ping && (ping.ok || ping.status < 500)) {
      return {
        online: true,
        latencyMs: Date.now() - start,
        models: [HERMES_DEFAULTS.DEFAULT_MODEL],
        activeModel: HERMES_DEFAULTS.DEFAULT_MODEL,
        availableProfiles: profiles,
        degradedFallback: false,
        message: `Zeabur 伺服器在線 (HTTP ${ping.status})`
      };
    }

    return {
      online: false,
      latencyMs: Date.now() - start,
      models: [HERMES_DEFAULTS.DEFAULT_MODEL],
      activeModel: HERMES_DEFAULTS.DEFAULT_MODEL,
      availableProfiles: profiles,
      degradedFallback: true,
      message: "無法連線至 Zeabur 伺服器，已自動啟用本地高擬真備援沙盒"
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      online: false,
      latencyMs: Date.now() - start,
      models: [HERMES_DEFAULTS.DEFAULT_MODEL],
      activeModel: HERMES_DEFAULTS.DEFAULT_MODEL,
      availableProfiles: profiles,
      degradedFallback: true,
      message: `連線探測異常 (${msg})，已啟動本地高擬真備援`
    };
  }
}
