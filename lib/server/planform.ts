import { ApiError } from "./security";
import { runtimeEnv } from "./credentials";
import { getMcp, githubIsNotMcp, probeMcp } from "./mcp-registry";

export function planformStatus() {
  const url = runtimeEnv("PLANFORM_MCP_URL");
  if (!url)
    return {
      id: "planform",
      name: "Planform 場佈",
      state: "unconfigured" as const,
      detail: "尚未設定 PLANFORM_MCP_URL。GitHub 倉庫網址不是 MCP，請填 Planform 的 /mcp。",
    };
  if (githubIsNotMcp(url))
    return {
      id: "planform",
      name: "Planform 場佈",
      state: "failed" as const,
      detail: "GitHub 網址不是 MCP 端點。請改填 Planform 的 https://…/mcp。",
    };
  return {
    id: "planform",
    name: "Planform 場佈",
    state: "partial" as const,
    detail: runtimeEnv("PLANFORM_MCP_TOKEN")
      ? "已設定端點與服務憑證，需 initialize／tools/list 驗證後 Hermes 才能呼叫場佈工具。"
      : "已設定端點。可選 PLANFORM_MCP_TOKEN；驗證成功後 Hermes 可呼叫 planform_run_agent。",
  };
}

export async function testPlanformConnection() {
  if (!runtimeEnv("PLANFORM_MCP_URL"))
    throw new ApiError(400, "planform_unconfigured", "請先儲存 Planform MCP 網址。");
  const entry = getMcp("planform");
  if (!entry)
    throw new ApiError(400, "planform_unconfigured", "Planform MCP 尚未出現在核准清單。");
  const probed = await probeMcp(entry);
  return {
    probe: {
      status: probed.status,
      toolsCount: probed.tools.length,
      lastError: probed.lastError,
    },
  };
}
