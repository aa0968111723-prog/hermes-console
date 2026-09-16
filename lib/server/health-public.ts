import type { Health } from "../contracts";
import { HERMES_UNCONFIGURED_MESSAGE } from "../contracts";
import { credentialPresence } from "./credentials";
import { get, probeStore } from "./store";

const EMPTY_DISCOVERY = {
  features: {},
  models: [] as string[],
  skills: [] as Health["skills"],
  toolsets: [] as Health["toolsets"],
  discovery: {} as Health["discovery"],
};

export function redactHealthDiscovery(state: Health): Health {
  return {
    ...state,
    ...EMPTY_DISCOVERY,
  };
}

export function publicHealthStatus(owner: string): Health {
  const probe = probeStore();
  const store = {
    backend: probe.backend,
    dataDir: probe.dataDir,
    storeReady: probe.ok,
  } as const;
  const configSource = {
    hermesUrl: credentialPresence("HERMES_API_URL").source,
    hermesKey: credentialPresence("HERMES_API_KEY").source,
  };
  let cached: Health | null = null;
  try {
    const row = get<Health & { id: string; targetHash: string }>(
      "health",
      owner,
      "current",
    );
    if (row) {
      const { id, targetHash, ...rest } = row;
      void id;
      void targetHash;
      cached = rest;
    }
  } catch {
    cached = null;
  }
  const missing =
    configSource.hermesKey === "none" || configSource.hermesUrl === "none";
  return redactHealthDiscovery({
    checkedAt: cached?.checkedAt || new Date().toISOString(),
    reachable: cached?.reachable ?? null,
    credential:
      cached?.credential ?? (configSource.hermesKey === "none" ? "missing" : "unknown"),
    agent: cached?.agent ?? "unverified",
    status: cached?.status ?? (missing ? "unconfigured" : "partial"),
    message:
      cached?.message ||
      (missing
        ? HERMES_UNCONFIGURED_MESSAGE
        : "已設定連線；詳細能力僅登入後可見。"),
    configSource,
    httpStatus: cached?.httpStatus ?? null,
    ...EMPTY_DISCOVERY,
    ...store,
  });
}
