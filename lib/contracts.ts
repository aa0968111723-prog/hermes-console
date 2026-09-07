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
  toolCallId?: string | null;
  errorCode?: string;
  retryable?: boolean;
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
  assistantMode?: "creative" | "research" | "admin";
  researchBundle?: ResearchBundle;
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
  researchBundle?: ResearchBundle;
  goal?: StructuredGoal;
  plan?: ExecutionPlan;
  budgetMode?: BudgetMode;
}
export type BudgetMode = "fast" | "balanced" | "deep";
export interface StructuredGoal {
  goal: string;
  audience: string | null;
  output: string | null;
  constraints: string[];
  requiresResearch: boolean;
  requiresDesign: boolean;
  requiresAudienceEvaluation: boolean;
  requiresTamkang: boolean;
  requiresInspiration: boolean;
}
export interface PlanStep {
  id: string;
  title: string;
  purpose: string;
  dependencies: string[];
  agent: string;
  tool: string | null;
  fallback: string | null;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
}
export interface FallbackRecord {
  from: string;
  to: string;
  reason: string;
  userVisible: string;
}
export interface ExecutionPlan {
  summary: string;
  budgetMode: BudgetMode;
  steps: PlanStep[];
  fallbacks: FallbackRecord[];
}
export interface ResearchSourceRecord {
  id: string;
  url: string;
  provider: string;
  title: string;
  excerpt: string;
  retrievedAt: string | null;
  publishedAt: string | null;
  official: boolean;
  confidence: number | null;
  usedFor: string;
  verification: "not_fetched";
}
export interface ResearchBundle {
  queries: string[];
  executed: boolean;
  message: string;
  sources: unknown[];
  claims: unknown[];
  sourceDirectory: ResearchSourceRecord[];
  fallback: null;
  suggestedFallback: string;
  tamkang?: unknown;
  mapping?: unknown;
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
  configSource?: {
    hermesUrl: "vault" | "env" | "none";
    hermesKey: "vault" | "env" | "none";
  };
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
