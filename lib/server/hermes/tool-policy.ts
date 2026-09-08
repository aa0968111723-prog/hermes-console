import { ApiError, hash } from "../security";
import { get, list, put } from "../store";
import type { HermesRuntimeSnapshot, ToolDescriptor } from "../../runtime";

export type ToolBinding = {
  id: string;
  projectId: string;
  agentId?: string;
  toolName: string;
  enabled: boolean;
  priority: number;
  allowedTools: string[];
  blockedTools: string[];
  permissionOverrides: Record<string, string>;
};
export function listRuntimeBindings(owner: string, projectId?: string) {
  return list<ToolBinding>("runtime_binding", owner).filter(
    (b) => !projectId || b.projectId === projectId,
  );
}
function bindingsFor(owner: string, projectId?: string, agentId?: string) {
  return projectId
    ? listRuntimeBindings(owner, projectId).filter(
        (b) => !b.agentId || b.agentId === agentId,
      )
    : [];
}
function allowed(bindings: ToolBinding[], name: string) {
  // Deny wins across project and agent rules. Neither can broaden the other.
  return bindings
    .filter((b) => b.toolName === name)
    .every(
      (b) =>
        b.enabled &&
        !b.blockedTools.includes(name) &&
        (!b.allowedTools.length || b.allowedTools.includes(name)),
    );
}
export function filterBoundTools(
  owner: string,
  tools: ToolDescriptor[],
  projectId?: string,
  agentId?: string,
) {
  const bindings = bindingsFor(owner, projectId, agentId);
  const priority = (name: string) => {
    const values = bindings
      .filter((b) => b.toolName === name)
      .map((b) => b.priority);
    return values.length ? Math.max(...values) : 0;
  };
  return tools
    .filter(
      (t) =>
        (t.projectScope === "all" ||
          (!!projectId && t.projectScope.includes(projectId))) &&
        (t.agentScope === "all" ||
          (!!agentId && t.agentScope.includes(agentId))) &&
        allowed(bindings, t.canonicalName),
    )
    .sort((a, b) => priority(b.canonicalName) - priority(a.canonicalName));
}
export function assertWorkspaceToolAllowed(
  owner: string,
  projectId: string,
  name: string,
  agentId = "general",
) {
  if (
    !allowed(
      bindingsFor(owner, projectId, agentId),
      "console-workspace." + name,
    )
  )
    throw new ApiError(
      403,
      "tool_binding_denied",
      "此專案已停用或封鎖這個工具；未執行操作。",
    );
}
export function saveRuntimeBinding(
  owner: string,
  input: Omit<ToolBinding, "id">,
) {
  if (input.projectId !== "personal" && !get("project", owner, input.projectId))
    throw new ApiError(404, "project_not_found", "專案不存在。");
  const tool = get<HermesRuntimeSnapshot>(
    "runtime_snapshot",
    owner,
    "current",
  )?.tools.find((t) => t.canonicalName === input.toolName);
  const workspaceBinding =
    tool?.source === "console-workspace" ||
    (!tool && input.toolName.startsWith("console-workspace."));
  if (!workspaceBinding || (input.agentId && input.agentId !== "general"))
    throw new ApiError(
      409,
      "binding_execution_unsupported",
      "目前僅能強制限制 Console workspace 工具與 general Agent；尚無已驗證的 Hermes 原生／外部 MCP 權限介面。",
    );
  if (!tool)
    throw new ApiError(
      404,
      "runtime_tool_not_found",
      "請先同步，工具必須存在於目前清單。",
    );
  if (Object.keys(input.permissionOverrides).length)
    throw new ApiError(
      409,
      "permission_override_unsupported",
      "權限覆寫尚未支援，不能將寫入工具降級為唯讀或取消確認。",
    );
  const id = hash(
    [input.projectId, input.agentId || "", input.toolName].join("|"),
  );
  return put("runtime_binding", owner, { ...input, id });
}
