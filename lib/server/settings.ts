import { z } from "zod";
import { ApiError, limited } from "./security";
import {
  CREDENTIAL_KEYS,
  credentialPresence,
  publicCredentialFields,
  runtimeEnv,
  saveVaultCredentials,
  vaultStatus,
  type CredentialKey,
  type CredentialValues,
} from "./credentials";
import { getMcp, githubIsNotMcp, probeMcp, configuredMcp } from "./mcp-registry";
import { tamkangStatus } from "./tamkang";
import { xunheStatus } from "./xunhe";
import { zeaburPublicStatus } from "./zeabur";

const mcpDefinition = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{2,40}$/),
    name: z.string().min(1).max(80),
    endpoint: z.string().url(),
    credentialReference: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{2,80}$/)
      .nullable()
      .default(null),
    readonly: z.boolean().default(true),
  })
  .strict();

export const credentialsInput = z
  .object({
    HERMES_API_URL: z.string().max(500).optional(),
    HERMES_API_KEY: z.string().max(500).optional(),
    HERMES_MODEL: z.string().max(80).optional(),
    MCP_BRIDGE_TOKEN: z.string().max(500).optional(),
    CONSOLE_MCP_SERVERS_JSON: z.string().max(20_000).optional(),
    TKU_MCP_URL: z.string().max(500).optional(),
    TKU_MCP_TOKEN: z.string().max(2_000).optional(),
    XUNHE_MCP_URL: z.string().max(500).optional(),
    XUNHE_MCP_TOKEN: z.string().max(2_000).optional(),
    ATLAS_MCP_URL: z.string().max(500).optional(),
    ATLAS_MCP_TOKEN: z.string().max(2_000).optional(),
    CONSISTENCYLAB_MCP_URL: z.string().max(500).optional(),
    CONSISTENCYLAB_MCP_TOKEN: z.string().max(2_000).optional(),
    ZEABUR_API_TOKEN: z.string().max(500).optional(),
    ZEABUR_PROJECT_ID: z.string().max(80).optional(),
    ZEABUR_SERVICE_ID: z.string().max(80).optional(),
    ZEABUR_ENVIRONMENT_ID: z.string().max(80).optional(),
    clear: z.array(z.enum(CREDENTIAL_KEYS)).optional(),
  })
  .strict();

export function validateHttpsServiceUrl(
  value: string,
  kind: "hermes" | "mcp",
) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError(400, "invalid_url", "網址格式不正確。");
  }
  const local =
    process.env.HERMES_ALLOW_LOOPBACK_HTTP === "true" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new ApiError(
      400,
      "invalid_url",
      kind === "hermes"
        ? "Hermes 服務設定不安全；需要無帳密與查詢參數的 HTTPS 網域。"
        : "MCP 目標需為無帳密與查詢參數的受控 HTTPS 端點。",
    );
  if (kind === "hermes") {
    url.pathname = url.pathname.replace(/\/$/, "").replace(/\/v1$/, "");
    if (
      url.pathname &&
      url.pathname !== "/" &&
      !/^\/p\/[a-zA-Z0-9_-]+$/.test(url.pathname)
    )
      throw new ApiError(
        400,
        "invalid_url",
        "Hermes API 網址只能使用網域或受控 profile 路徑。",
      );
  }
  if (kind === "mcp" && githubIsNotMcp(url.toString()))
    throw new ApiError(400, "github_is_not_mcp", "GitHub 網址不是 MCP 端點。");
  return url.toString().replace(/\/$/, "");
}

function validatePatch(patch: CredentialValues) {
  if (patch.HERMES_API_URL)
    patch.HERMES_API_URL = validateHttpsServiceUrl(
      patch.HERMES_API_URL,
      "hermes",
    );
  if (patch.TKU_MCP_URL)
    patch.TKU_MCP_URL = validateHttpsServiceUrl(patch.TKU_MCP_URL, "mcp");
  if (patch.XUNHE_MCP_URL)
    patch.XUNHE_MCP_URL = validateHttpsServiceUrl(patch.XUNHE_MCP_URL, "mcp");
  if (patch.ATLAS_MCP_URL)
    patch.ATLAS_MCP_URL = validateHttpsServiceUrl(patch.ATLAS_MCP_URL, "mcp");
  if (patch.CONSISTENCYLAB_MCP_URL)
    patch.CONSISTENCYLAB_MCP_URL = validateHttpsServiceUrl(
      patch.CONSISTENCYLAB_MCP_URL,
      "mcp",
    );
  if (patch.HERMES_API_KEY && patch.HERMES_API_KEY.length < 8)
    throw new ApiError(400, "invalid_secret", "Hermes 金鑰長度不足。");
  if (patch.TKU_MCP_TOKEN && patch.TKU_MCP_TOKEN.length < 8)
    throw new ApiError(400, "invalid_secret", "淡江 MCP 權杖長度不足。");
  if (patch.XUNHE_MCP_TOKEN && patch.XUNHE_MCP_TOKEN.length < 8)
    throw new ApiError(400, "invalid_secret", "訊核 MCP 權杖長度不足。");
  if (patch.ATLAS_MCP_TOKEN && patch.ATLAS_MCP_TOKEN.length < 16)
    throw new ApiError(400, "invalid_secret", "場圖 MCP 權杖長度不足。");
  if (patch.CONSISTENCYLAB_MCP_TOKEN && patch.CONSISTENCYLAB_MCP_TOKEN.length < 8)
    throw new ApiError(400, "invalid_secret", "ConsistencyLab MCP 權杖長度不足。");
  if (patch.MCP_BRIDGE_TOKEN && patch.MCP_BRIDGE_TOKEN.length < 32)
    throw new ApiError(
      400,
      "invalid_secret",
      "MCP 橋接權杖至少需要 32 個字元。",
    );
  if (patch.ZEABUR_API_TOKEN && patch.ZEABUR_API_TOKEN.length < 16)
    throw new ApiError(400, "invalid_secret", "Zeabur API 權杖長度不足。");
  for (const key of [
    "ZEABUR_PROJECT_ID",
    "ZEABUR_SERVICE_ID",
    "ZEABUR_ENVIRONMENT_ID",
  ] as const) {
    const value = patch[key];
    if (value && !/^[a-zA-Z0-9]{8,40}$/.test(value))
      throw new ApiError(400, "invalid_id", "Zeabur 識別格式不正確。");
  }
  if (patch.CONSOLE_MCP_SERVERS_JSON) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(patch.CONSOLE_MCP_SERVERS_JSON);
    } catch {
      throw new ApiError(400, "mcp_config_invalid", "MCP 核准清單不是有效 JSON。");
    }
    const result = z.array(mcpDefinition).max(30).safeParse(parsed);
    if (!result.success)
      throw new ApiError(400, "mcp_config_invalid", "MCP 核准清單格式錯誤。");
    patch.CONSOLE_MCP_SERVERS_JSON = JSON.stringify(result.data);
  }
  return patch;
}

export function publicSettings() {
  const tamkang = liveTamkangStatus();
  return {
    vault: vaultStatus(),
    fields: publicCredentialFields(),
    hermes: {
      configured: !!(runtimeEnv("HERMES_API_URL") && runtimeEnv("HERMES_API_KEY")),
      urlSource: credentialPresence("HERMES_API_URL").source,
      keySource: credentialPresence("HERMES_API_KEY").source,
    },
    mcpBridge: credentialPresence("MCP_BRIDGE_TOKEN"),
    xunhe: {
      ...xunheStatus(),
      configured: !!runtimeEnv("XUNHE_MCP_URL"),
      urlSource: credentialPresence("XUNHE_MCP_URL").source,
      tokenSource: credentialPresence("XUNHE_MCP_TOKEN").source,
    },
    tamkang: {
      ...tamkang,
      urlSource: credentialPresence("TKU_MCP_URL").source,
      tokenSource: credentialPresence("TKU_MCP_TOKEN").source,
    },
    atlas: {
      configured: !!(runtimeEnv("ATLAS_MCP_URL") && runtimeEnv("ATLAS_MCP_TOKEN")),
      urlSource: credentialPresence("ATLAS_MCP_URL").source,
      tokenSource: credentialPresence("ATLAS_MCP_TOKEN").source,
    },
    consistencylab: liveConsistencylabStatus(),
    zeabur: zeaburPublicStatus(),
    openSettingsWarning:
      "此設定頁沒有邀請登入或閘道保護。能開啟網站的人都可以覆寫連線憑證與 Zeabur 部署。",
  };
}

export function saveCredentials(input: z.infer<typeof credentialsInput>) {
  const { clear, ...raw } = input;
  const patch = validatePatch(raw);
  saveVaultCredentials(patch, clear as CredentialKey[] | undefined);
  return publicSettings();
}

function liveTamkangStatus() {
  const entry = getMcp("tku");
  if (!entry)
    return tamkangStatus({
      reachable: runtimeEnv("TKU_MCP_URL") ? false : undefined,
    });
  return tamkangStatus({
    reachable: entry.status === "failed" ? false : undefined,
    tools: entry.tools,
    verifiedRead: entry.status === "verified",
  });
}

export async function testXunheConnection() {
  if (!runtimeEnv("XUNHE_MCP_URL"))
    throw new ApiError(400, "xunhe_unconfigured", "請先儲存訊核 MCP 網址。");
  const entry = getMcp("xunhe");
  if (!entry)
    throw new ApiError(400, "xunhe_unconfigured", "訊核 MCP 尚未出現在核准清單。");
  const probed = await probeMcp(entry);
  return {
    ...publicSettings(),
    probe: {
      status: probed.status,
      toolsCount: probed.tools.length,
      lastError: probed.lastError,
    },
  };
}

export async function testAtlasConnection() {
  if (!runtimeEnv("ATLAS_MCP_URL"))
    throw new ApiError(400, "atlas_unconfigured", "請先儲存場圖 Atlas MCP 網址。");
  if (!runtimeEnv("ATLAS_MCP_TOKEN"))
    throw new ApiError(400, "atlas_token_missing", "請先貼上場圖 ATLAS_MCP_TOKEN。");
  const entry = getMcp("atlas");
  if (!entry)
    throw new ApiError(400, "atlas_unconfigured", "場圖 MCP 尚未出現在核准清單。");
  const probed = await probeMcp(entry);
  return {
    ...publicSettings(),
    probe: {
      status: probed.status,
      toolsCount: probed.tools.length,
      lastError: probed.lastError,
    },
  };
}

function liveConsistencylabStatus() {
  const url = runtimeEnv("CONSISTENCYLAB_MCP_URL");
  let listed = false;
  try {
    listed = configuredMcp().some((item) => item.id === "consistencylab");
  } catch {
    listed = false;
  }
  const entry = getMcp("consistencylab");
  return {
    configured: Boolean(url || listed),
    urlSource: credentialPresence("CONSISTENCYLAB_MCP_URL").source,
    tokenSource: credentialPresence("CONSISTENCYLAB_MCP_TOKEN").source,
    status: entry?.status || "unconfigured",
    toolsCount: entry?.tools.length || 0,
    lastError: entry?.lastError || null,
    detail: entry?.lastError
      ? entry.lastError
      : url || listed
        ? "已設定 ConsistencyLab 端點，等待 tools/list 驗證。"
        : "尚未在連線設定或後端環境變數提供 CONSISTENCYLAB_MCP_URL。",
  };
}

export async function testConsistencylabConnection() {
  if (!runtimeEnv("CONSISTENCYLAB_MCP_URL"))
    throw new ApiError(
      400,
      "consistencylab_unconfigured",
      "請先儲存 ConsistencyLab MCP 網址。",
    );
  const entry = getMcp("consistencylab");
  if (!entry)
    throw new ApiError(
      400,
      "consistencylab_unconfigured",
      "ConsistencyLab MCP 尚未出現在核准清單。",
    );
  const probed = await probeMcp(entry);
  return {
    ...publicSettings(),
    probe: {
      status: probed.status,
      toolsCount: probed.tools.length,
      lastError: probed.lastError,
    },
  };
}

export async function testTamkangConnection() {
  if (!runtimeEnv("TKU_MCP_URL"))
    throw new ApiError(
      400,
      "tku_unconfigured",
      "請先儲存淡江 MCP 網址。",
    );
  if (!runtimeEnv("TKU_MCP_TOKEN"))
    throw new ApiError(
      400,
      "tku_token_missing",
      "請先貼上淡江 MCP 權杖，或使用校園憑證交換權杖。",
    );
  const entry = getMcp("tku");
  if (!entry)
    throw new ApiError(400, "tku_unconfigured", "淡江 MCP 尚未出現在核准清單。");
  const probed = await probeMcp(entry);
  return {
    ...publicSettings(),
    probe: {
      status: probed.status,
      toolsCount: probed.tools.length,
      lastError: probed.lastError,
    },
  };
}

function extractToken(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  for (const key of ["access_token", "token", "accessToken"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length >= 8)
      return value.trim();
  }
  for (const nested of ["data", "result", "auth"]) {
    const found = extractToken(record[nested]);
    if (found) return found;
  }
  return null;
}

async function readJsonLimited(response: Response, maxBytes = 64_000) {
  if (!response.headers.get("content-type")?.includes("json")) {
    await response.body?.cancel();
    return null;
  }
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    return null;
  }
}

export async function exchangeTamkangLogin(
  username: string,
  password: string,
) {
  limited("tku-login:" + (runtimeEnv("TKU_MCP_URL") || "none"), 10, 15 * 60_000);
  const endpoint = runtimeEnv("TKU_MCP_URL");
  if (!endpoint)
    throw new ApiError(400, "tku_unconfigured", "請先儲存淡江 MCP 網址。");
  const target = new URL(validateHttpsServiceUrl(endpoint, "mcp"));
  const candidates = [
    new URL("/auth/login", target.origin),
    new URL("/api/auth/login", target.origin),
    new URL("/login", target.origin),
  ];
  const bodies: Array<{ type: string; body: string }> = [
    {
      type: "application/json",
      body: JSON.stringify({ username, password }),
    },
    {
      type: "application/x-www-form-urlencoded",
      body: new URLSearchParams({
        grant_type: "password",
        username,
        password,
      }).toString(),
    },
  ];
  for (const url of candidates) {
    if (url.origin !== target.origin) continue;
    let reached = false;
    for (const payload of bodies) {
      try {
        const response = await fetch(url, {
          method: "POST",
          redirect: "error",
          cache: "no-store",
          headers: { "Content-Type": payload.type },
          body: payload.body,
          signal: AbortSignal.timeout(4_000),
        });
        reached = true;
        const data = await readJsonLimited(response);
        const token = extractToken(data);
        if (response.ok && token) {
          saveVaultCredentials({ TKU_MCP_TOKEN: token });
          return {
            exchanged: true as const,
            ...(await testTamkangConnection()),
          };
        }
        if (response.status === 401 || response.status === 403) break;
      } catch {
        /* try next candidate; never echo upstream bodies */
      }
    }
    if (reached) continue;
  }
  try {
    const response = await fetch(target, {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "auth/login",
        params: { username, password },
      }),
      signal: AbortSignal.timeout(4_000),
    });
    const data = await readJsonLimited(response);
    const token = extractToken(data) || extractToken(
      data && typeof data === "object"
        ? (data as { result?: unknown }).result
        : null,
    );
    if (token) {
      saveVaultCredentials({ TKU_MCP_TOKEN: token });
      return {
        exchanged: true as const,
        ...(await testTamkangConnection()),
      };
    }
  } catch {
    /* no known auth method */
  }
  throw new ApiError(
    502,
    "tku_login_unsupported",
    "淡江 MCP 未提供已知的帳密交換端點。請改貼 Bearer 權杖後測試連線。",
  );
}
