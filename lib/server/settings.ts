import { z } from "zod";
import {
  ApiError,
  assertSafeServiceUrl,
  isLoopbackHost,
} from "./security";
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
import { getMcp, githubIsNotMcp, probeMcp, atlasStatus } from "./mcp-registry";
import { liveTamkangStatus } from "./tamkang";
import { liveGalleyStatus } from "./galley";
import { xunheStatus } from "./xunhe";
import { planformStatus } from "./planform";
import { lumenConfigured, lumenStatus } from "./lumen";
import { framelabStatus } from "./framelab";
import { duigaoStatus } from "./duigao";
import { zeaburPublicStatus } from "./zeabur";
import { hermesConnectionStatus } from "./hermes";

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
    GALLEY_MCP_URL: z.string().max(500).optional(),
    GALLEY_MCP_TOKEN: z.string().max(2_000).optional(),
    XUNHE_MCP_URL: z.string().max(500).optional(),
    XUNHE_MCP_TOKEN: z.string().max(2_000).optional(),
    PLANFORM_MCP_URL: z.string().max(500).optional(),
    PLANFORM_MCP_TOKEN: z.string().max(2_000).optional(),
    ATLAS_MCP_URL: z.string().max(500).optional(),
    ATLAS_MCP_TOKEN: z.string().max(2_000).optional(),
    LUMEN_MCP_URL: z.string().max(500).optional(),
    LUMEN_MCP_TOKEN: z.string().max(2_000).optional(),
    FRAMELAB_MCP_URL: z.string().max(500).optional(),
    FRAMELAB_MCP_TOKEN: z.string().max(2_000).optional(),
    DUIGAO_MCP_URL: z.string().max(500).optional(),
    DUIGAO_MCP_TOKEN: z.string().max(2_000).optional(),
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
    isLoopbackHost(url.hostname);
  assertSafeServiceUrl(value, kind === "hermes" ? "hermes" : "mcp");
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
  if (patch.GALLEY_MCP_URL)
    patch.GALLEY_MCP_URL = validateHttpsServiceUrl(patch.GALLEY_MCP_URL, "mcp");
  if (patch.XUNHE_MCP_URL)
    patch.XUNHE_MCP_URL = validateHttpsServiceUrl(patch.XUNHE_MCP_URL, "mcp");
  if (patch.PLANFORM_MCP_URL)
    patch.PLANFORM_MCP_URL = validateHttpsServiceUrl(
      patch.PLANFORM_MCP_URL,
      "mcp",
    );
  if (patch.ATLAS_MCP_URL)
    patch.ATLAS_MCP_URL = validateHttpsServiceUrl(patch.ATLAS_MCP_URL, "mcp");
  if (patch.LUMEN_MCP_URL)
    patch.LUMEN_MCP_URL = validateHttpsServiceUrl(patch.LUMEN_MCP_URL, "mcp");
  if (patch.FRAMELAB_MCP_URL)
    patch.FRAMELAB_MCP_URL = validateHttpsServiceUrl(patch.FRAMELAB_MCP_URL, "mcp");
  if (patch.DUIGAO_MCP_URL)
    patch.DUIGAO_MCP_URL = validateHttpsServiceUrl(patch.DUIGAO_MCP_URL, "mcp");
  if (patch.HERMES_API_KEY && patch.HERMES_API_KEY.length < 8)
    throw new ApiError(400, "invalid_secret", "Hermes 金鑰長度不足。");
  if (patch.TKU_MCP_TOKEN && patch.TKU_MCP_TOKEN.length < 8)
    throw new ApiError(400, "invalid_secret", "淡江 MCP 權杖長度不足。");
  if (patch.GALLEY_MCP_TOKEN && patch.GALLEY_MCP_TOKEN.length < 32)
    throw new ApiError(
      400,
      "invalid_secret",
      "GALLEY MCP 權杖至少需要 32 個字元。",
    );
  if (patch.XUNHE_MCP_TOKEN && patch.XUNHE_MCP_TOKEN.length < 8)
    throw new ApiError(400, "invalid_secret", "訊核 MCP 權杖長度不足。");
  if (patch.PLANFORM_MCP_TOKEN && patch.PLANFORM_MCP_TOKEN.length < 16)
    throw new ApiError(400, "invalid_secret", "Planform MCP 權杖至少需要 16 個字元。");
  if (patch.ATLAS_MCP_TOKEN && patch.ATLAS_MCP_TOKEN.length < 16)
    throw new ApiError(400, "invalid_secret", "場圖 MCP 權杖長度不足。");
  if (patch.LUMEN_MCP_TOKEN && patch.LUMEN_MCP_TOKEN.length < 32)
    throw new ApiError(400, "invalid_secret", "Lumen MCP 權杖至少需要 32 個字元。");
  if (patch.FRAMELAB_MCP_TOKEN && patch.FRAMELAB_MCP_TOKEN.length < 16)
    throw new ApiError(400, "invalid_secret", "FrameLab MCP 權杖長度不足。");
  if (patch.DUIGAO_MCP_TOKEN && patch.DUIGAO_MCP_TOKEN.length < 16)
    throw new ApiError(400, "invalid_secret", "對稿 MCP 權杖長度不足。");
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
    hermes: hermesConnectionStatus(),
    mcpBridge: {
      ...credentialPresence("MCP_BRIDGE_TOKEN"),
      state: credentialPresence("MCP_BRIDGE_TOKEN").configured
        ? "awaiting_authorization"
        : "unconfigured",
      detail: credentialPresence("MCP_BRIDGE_TOKEN").configured
        ? "已設定 Workspace MCP 權杖，尚未由 Hermes 完成連線驗證。"
        : "尚未設定 MCP_BRIDGE_TOKEN。",
    },
    xunhe: {
      ...xunheStatus(),
      configured: !!runtimeEnv("XUNHE_MCP_URL"),
      urlSource: credentialPresence("XUNHE_MCP_URL").source,
      tokenSource: credentialPresence("XUNHE_MCP_TOKEN").source,
    },
    planform: {
      ...planformStatus(),
      configured: !!runtimeEnv("PLANFORM_MCP_URL"),
      urlSource: credentialPresence("PLANFORM_MCP_URL").source,
      tokenSource: credentialPresence("PLANFORM_MCP_TOKEN").source,
    },
    lumen: {
      ...lumenStatus(),
      configured: lumenConfigured(),
      urlSource: credentialPresence("LUMEN_MCP_URL").source,
      tokenSource: credentialPresence("LUMEN_MCP_TOKEN").source,
    },
    tamkang: {
      ...tamkang,
      urlSource: credentialPresence("TKU_MCP_URL").source,
      tokenSource: credentialPresence("TKU_MCP_TOKEN").source,
    },
    galley: {
      ...liveGalleyStatus(),
      urlSource: credentialPresence("GALLEY_MCP_URL").source,
      tokenSource: credentialPresence("GALLEY_MCP_TOKEN").source,
    },
    atlas: {
      ...atlasStatus(),
      configured: !!(runtimeEnv("ATLAS_MCP_URL") && runtimeEnv("ATLAS_MCP_TOKEN")),
      urlSource: credentialPresence("ATLAS_MCP_URL").source,
      tokenSource: credentialPresence("ATLAS_MCP_TOKEN").source,
    },
    framelab: {
      ...framelabStatus(),
      configured: !!(runtimeEnv("FRAMELAB_MCP_URL") && runtimeEnv("FRAMELAB_MCP_TOKEN")),
      urlSource: credentialPresence("FRAMELAB_MCP_URL").source,
      tokenSource: credentialPresence("FRAMELAB_MCP_TOKEN").source,
    },
    duigao: {
      ...duigaoStatus(),
      configured: !!(runtimeEnv("DUIGAO_MCP_URL") && runtimeEnv("DUIGAO_MCP_TOKEN")),
      urlSource: credentialPresence("DUIGAO_MCP_URL").source,
      tokenSource: credentialPresence("DUIGAO_MCP_TOKEN").source,
    },
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

export async function testFramelabConnection() {
  if (!runtimeEnv("FRAMELAB_MCP_URL"))
    throw new ApiError(400, "framelab_unconfigured", "請先儲存 FrameLab MCP 網址。");
  if (!runtimeEnv("FRAMELAB_MCP_TOKEN"))
    throw new ApiError(400, "framelab_token_missing", "請先貼上 FrameLab FRAMELAB_MCP_TOKEN。");
  const entry = getMcp("framelab");
  if (!entry)
    throw new ApiError(400, "framelab_unconfigured", "FrameLab MCP 尚未出現在核准清單。");
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

export async function testDuigaoConnection() {
  if (!runtimeEnv("DUIGAO_MCP_URL"))
    throw new ApiError(400, "duigao_unconfigured", "請先儲存對稿 MCP 網址。");
  if (!runtimeEnv("DUIGAO_MCP_TOKEN"))
    throw new ApiError(400, "duigao_token_missing", "請先貼上對稿 DUIGAO_MCP_TOKEN。");
  const entry = getMcp("duigao");
  if (!entry)
    throw new ApiError(400, "duigao_unconfigured", "對稿 MCP 尚未出現在核准清單。");
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
      "請先貼上淡江 MCP 權杖。Console 不收集學校密碼。",
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

export async function testGalleyConnection() {
  if (!runtimeEnv("GALLEY_MCP_URL"))
    throw new ApiError(
      400,
      "galley_unconfigured",
      "請先儲存 GALLEY MCP 網址。GitHub 網址不是 MCP 端點。",
    );
  if (!runtimeEnv("GALLEY_MCP_TOKEN"))
    throw new ApiError(
      400,
      "galley_token_missing",
      "請先貼上 GALLEY MCP 權杖（至少 32 字元）。",
    );
  const entry = getMcp("galley");
  if (!entry)
    throw new ApiError(
      400,
      "galley_unconfigured",
      "GALLEY MCP 尚未出現在核准清單。",
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

export async function testLumenConnection() {
  if (!runtimeEnv("LUMEN_MCP_URL"))
    throw new ApiError(400, "lumen_unconfigured", "請先儲存 Lumen MCP 網址。");
  if (!runtimeEnv("LUMEN_MCP_TOKEN") || runtimeEnv("LUMEN_MCP_TOKEN").length < 32)
    throw new ApiError(400, "lumen_token_missing", "請先貼上至少 32 字元的 Lumen MCP 權杖。");
  const entry = getMcp("lumen");
  if (!entry)
    throw new ApiError(400, "lumen_unconfigured", "Lumen MCP 尚未出現在核准清單。");
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
