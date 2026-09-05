/**
 * MCP (Model Context Protocol) 伺服器與工具權限分級定義
 */

export type ToolPermissionTier = "read" | "draft" | "write" | "publish" | "destructive";

export interface McpServerConfig {
  id: string;
  name: string;
  url?: string;
  token?: string;
  enabled: boolean;
  status: "connected" | "fallback_local" | "unconfigured" | "error";
  description: string;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  permissionTier: ToolPermissionTier;
  serverId: string;
  parameters: Record<string, unknown>;
}

export interface ConfirmationTokenPayload {
  token: string;
  action: string;
  toolName: string;
  payloadHash: string;
  expiresAt: number;
}
