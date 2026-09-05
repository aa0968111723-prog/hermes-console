export type IntegrationState =
  | "unconfigured"
  | "awaiting_authorization"
  | "verifying"
  | "available"
  | "partial"
  | "failed";
export type TaskState =
  | "queued"
  | "running"
  | "waiting_user"
  | "stopping"
  | "completed"
  | "failed"
  | "cancelled"
  | "uncertain";
export interface Usage {
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  durationMs: number | null;
  providerCost: number | null;
  toolCost: number | null;
}
export interface TaskEvent {
  id: string;
  taskId: string;
  toolName: string | null;
  status: string;
  startedAt: string;
  endedAt: string | null;
  summary: string;
  result: unknown;
  sources: string[];
  error: string | null;
  usage: Usage | null;
}
export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  taskId?: string;
  attachments?: string[];
  provenance?: "hermes" | "legacy_unverified";
}
export interface Conversation {
  id: string;
  title: string;
  projectId: string;
  messages: Message[];
  hermesSessionId: string | null;
  createdAt: string;
  updatedAt: string;
  parentId?: string;
  legacyId?: string;
}
export interface Task {
  id: string;
  conversationId: string;
  requestKey: string;
  payloadHash: string;
  state: TaskState;
  transport: "runs" | "chat";
  remoteId: string | null;
  input: string;
  attachments: string[];
  output: string;
  createdAt: string;
  updatedAt: string;
  endedAt: string | null;
  error: string | null;
  observationError: string | null;
  events: TaskEvent[];
  usage: Usage;
  stopSupported: boolean;
}
export interface Material {
  id: string;
  projectId: string;
  title: string;
  kind: "reference" | "image" | "text";
  url: string | null;
  mime: string | null;
  bytes: number | null;
  tags: string[];
  createdAt: string;
  rights: "reference_only" | "user_provided";
  notes: string;
}
export interface Health {
  checkedAt: string;
  reachable: boolean | null;
  credential: "valid" | "invalid" | "unknown" | "missing";
  agent: "verified" | "unverified" | "failed";
  status: IntegrationState;
  message: string;
  httpStatus: number | null;
  features: Record<string, boolean>;
  models: string[];
  skills: DiscoveryItem[];
  toolsets: DiscoveryItem[];
}
export interface DiscoveryItem {
  name: string;
  description: string;
  enabled?: boolean;
  configured?: boolean;
  tools?: string[];
}
export const EMPTY_USAGE: Usage = {
  model: null,
  inputTokens: null,
  outputTokens: null,
  totalTokens: null,
  durationMs: null,
  providerCost: null,
  toolCost: null,
};
