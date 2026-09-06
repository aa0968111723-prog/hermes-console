import type { ToolDescriptor } from "../runtime";

export interface ToolProviderAdapter {
  id: string;
  type: "hermes" | "mcp" | "native" | "oauth-api" | "project-api";
  discover(): Promise<ToolDescriptor[]>;
  health(): Promise<{ status: string; error?: string }>;
  listTools(): Promise<ToolDescriptor[]>;
  execute(tool: ToolDescriptor, input: unknown): Promise<unknown>;
  refresh(): Promise<void>;
  disconnect(): Promise<void>;
  metadata: Record<string, unknown>;
}

/** One normalized registry for Hermes, MCP, Console and future OAuth/API providers. */
export class UnifiedToolRegistry {
  private readonly entries = new Map<string, ToolDescriptor>();
  register(tool: ToolDescriptor) { this.entries.set(tool.canonicalName, tool); }
  registerMany(tools: Iterable<ToolDescriptor>) { for (const tool of tools) this.register(tool); return this; }
  get(canonicalName: string) { return this.entries.get(canonicalName) || null; }
  list(filter?: { projectId?: string; agentId?: string }) {
    return [...this.entries.values()].filter(tool => tool.enabled &&
      (tool.projectScope === "all" || !!filter?.projectId && tool.projectScope.includes(filter.projectId)) &&
      (tool.agentScope === "all" || !!filter?.agentId && tool.agentScope.includes(filter.agentId)));
  }
  all() { return [...this.entries.values()]; }
}
