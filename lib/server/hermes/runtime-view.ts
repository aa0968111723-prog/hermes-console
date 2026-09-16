import type {
  HermesRuntimeSnapshot,
  RuntimeMcpServer,
  ToolDescriptor,
} from "../../runtime";
import { redact } from "../security";

function publicTool(tool: ToolDescriptor): ToolDescriptor {
  return {
    ...tool,
    canonicalName: "",
    displayName: "",
    description: "",
    inputSchema: {},
    outputSchema: undefined,
    metadata: {},
  };
}

function publicMcpServer(server: RuntimeMcpServer): RuntimeMcpServer {
  return {
    ...server,
    transport: "",
    authMode: "",
    serverInfo: null,
    protocolVersion: null,
    capabilities: {},
    lastError: null,
    metadata: {},
  };
}

/** Members see Hermes / Memory / Tools / MCP readiness. Schemas stay operator-only. */
export function presentRuntimeSnapshot(
  snapshot: HermesRuntimeSnapshot,
  operator: boolean,
): HermesRuntimeSnapshot {
  const errors = snapshot.errors.map((message) => redact(message));
  if (operator) {
    return {
      ...snapshot,
      errors,
      mcpServers: snapshot.mcpServers.map((server) => ({
        ...server,
        lastError: server.lastError ? redact(server.lastError) : null,
      })),
    };
  }
  return {
    ...snapshot,
    models: [],
    capabilities: {},
    discovery: {},
    skills: [],
    toolsets: [],
    tools: snapshot.tools.map(publicTool),
    agents: snapshot.agents.map((agent) => ({
      ...agent,
      lastError: null,
      capabilities: {},
    })),
    mcpServers: snapshot.mcpServers.map(publicMcpServer),
    errors: errors.length ? ["目前無法確認工具狀態。"] : [],
    diagnostics: {
      snapshotAgeMs: snapshot.diagnostics.snapshotAgeMs,
      lastSuccessAt: snapshot.diagnostics.lastSuccessAt,
      lastFailureAt: snapshot.diagnostics.lastFailureAt,
      durationMs: snapshot.diagnostics.durationMs,
      toolCount: snapshot.diagnostics.toolCount,
      skillCount: snapshot.diagnostics.skillCount,
      toolsetCount: snapshot.diagnostics.toolsetCount,
      mcpToolCount: snapshot.diagnostics.mcpToolCount,
    },
  };
}
