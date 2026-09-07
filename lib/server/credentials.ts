import { ApiError, WORKSPACE_OWNER, registerRedactionSecrets } from "./security";
import { get, put } from "./store";
import { seal, unseal, vaultKeySource } from "./vault";

export const CREDENTIAL_KEYS = [
  "HERMES_API_URL",
  "HERMES_API_KEY",
  "HERMES_MODEL",
  "MCP_BRIDGE_TOKEN",
  "CONSOLE_MCP_SERVERS_JSON",
  "TKU_MCP_URL",
  "TKU_MCP_TOKEN",
  "XUNHE_MCP_URL",
  "XUNHE_MCP_TOKEN",
  "ATLAS_MCP_URL",
  "ATLAS_MCP_TOKEN",
  "LUMEN_MCP_URL",
  "LUMEN_MCP_TOKEN",
  "ZEABUR_API_TOKEN",
  "ZEABUR_PROJECT_ID",
  "ZEABUR_SERVICE_ID",
  "ZEABUR_ENVIRONMENT_ID",
] as const;

export type CredentialKey = (typeof CREDENTIAL_KEYS)[number];
export type ConfigSource = "vault" | "env" | "none";
export type CredentialValues = Partial<Record<CredentialKey, string>>;

const SECRET_KEYS = new Set<CredentialKey>([
  "HERMES_API_KEY",
  "MCP_BRIDGE_TOKEN",
  "TKU_MCP_TOKEN",
  "XUNHE_MCP_TOKEN",
  "ATLAS_MCP_TOKEN",
  "LUMEN_MCP_TOKEN",
  "ZEABUR_API_TOKEN",
]);

type StoredCredentials = {
  id: "current";
  ciphertext: string;
  updatedAt: string;
};

export function isSecretCredential(name: string) {
  return SECRET_KEYS.has(name as CredentialKey);
}

export function loadVaultCredentials(): CredentialValues {
  const row = get<StoredCredentials>("credentials", WORKSPACE_OWNER, "current");
  if (!row?.ciphertext) return {};
  try {
    const data = unseal<Record<string, unknown>>(row.ciphertext);
    const out: CredentialValues = {};
    if (!data || typeof data !== "object") return {};
    for (const key of CREDENTIAL_KEYS) {
      const value = data[key];
      if (typeof value === "string" && value.trim()) out[key] = value.trim();
    }
    return out;
  } catch {
    throw new ApiError(
      503,
      "vault_unreadable",
      "無法解密已儲存的連線設定；請確認 CONSOLE_VAULT_KEY 或資料目錄中的 vault.key 未變更。",
    );
  }
}

export function saveVaultCredentials(
  patch: CredentialValues,
  clear: CredentialKey[] = [],
) {
  const current = { ...loadVaultCredentials() };
  for (const key of clear) delete current[key];
  for (const key of CREDENTIAL_KEYS) {
    if (!(key in patch) || patch[key] === undefined) continue;
    const value = (patch[key] || "").trim();
    if (!value) {
      if (isSecretCredential(key)) continue;
      delete current[key];
      continue;
    }
    current[key] = value;
  }
  put("credentials", WORKSPACE_OWNER, {
    id: "current",
    ciphertext: seal(current),
    updatedAt: new Date().toISOString(),
  } satisfies StoredCredentials);
  return current;
}

export function runtimeEnv(name: string) {
  if ((CREDENTIAL_KEYS as readonly string[]).includes(name)) {
    const vault = loadVaultCredentials()[name as CredentialKey];
    if (vault) return vault;
  }
  return (process.env[name] || "").trim();
}

export function credentialPresence(name: string): {
  configured: boolean;
  last4: string | null;
  source: ConfigSource;
} {
  const vault = (CREDENTIAL_KEYS as readonly string[]).includes(name)
    ? (loadVaultCredentials()[name as CredentialKey] || "").trim()
    : "";
  if (vault)
    return {
      configured: true,
      last4: secretLast4(name, vault),
      source: "vault",
    };
  const env = (process.env[name] || "").trim();
  if (env)
    return { configured: true, last4: secretLast4(name, env), source: "env" };
  return { configured: false, last4: null, source: "none" };
}

function secretLast4(name: string, value: string) {
  if (!isSecretCredential(name)) return null;
  return value.length >= 4 ? value.slice(-4) : "****";
}

export function publicCredentialFields() {
  return Object.fromEntries(
    CREDENTIAL_KEYS.map((name) => {
      const presence = credentialPresence(name);
      return [
        name,
        {
          configured: presence.configured,
          last4: presence.last4,
          source: presence.source,
          value: isSecretCredential(name) ? undefined : runtimeEnv(name) || "",
        },
      ];
    }),
  );
}

export function vaultStatus() {
  return { ready: true as const, source: vaultKeySource() };
}

registerRedactionSecrets(() => {
  try {
    const values = loadVaultCredentials();
    return CREDENTIAL_KEYS.flatMap((key) =>
      isSecretCredential(key) && values[key] ? [values[key]!] : [],
    );
  } catch {
    return [];
  }
});
