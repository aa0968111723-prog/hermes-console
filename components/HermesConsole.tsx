"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Check,
  ChevronDown,
  Copy,
  Folder,
  ImagePlus,
  Images,
  Leaf,
  ListTodo,
  Sparkles,
  Bot,
  Menu,
  MessageSquare,
  PanelLeftClose,
  Pencil,
  Plus,
  RefreshCw,
  Settings,
  Square,
  X,
  Link as LinkIcon,
  ExternalLink,
  Download,
} from "lucide-react";
import type { Conversation, Health, Material, Task } from "@/lib/contracts";
import type { Integration } from "@/lib/server/integrations";
import type { Workflow } from "@/lib/server/workflows";
import MessageBody from "./MessageBody";
import Turtle from "./Turtle";
import AgentPanel from "./agents/AgentPanel";
import RuntimeInspector from "./RuntimeInspector";
import InspirationBoard from "./inspiration/InspirationBoard";
import ProjectWorkbench from "./ProjectWorkbench";
import LearningMap from "./LearningMap";
import IntegrationHealth from "./settings/IntegrationHealth";
import CapabilityCertification from "./settings/CapabilityCertification";
import ConnectionSettings from "./settings/ConnectionSettings";
import SharedMemory from "./settings/SharedMemory";
import HermesCore from "./visual/HermesCore";
import QuickActions from "./visual/QuickActions";
import AgentOrbit from "./visual/AgentOrbit";
import AgentActivity from "./visual/AgentActivity";
import VisualStatus from "./visual/VisualStatus";
import AppDock from "./visual/AppDock";
import ArtifactStage from "./visual/ArtifactStage";
import ComposerMenu from "./visual/ComposerMenu";
import ComposerTaskStatus from "./visual/ComposerTaskStatus";
import ContextTray from "./visual/ContextTray";
import ProjectShelf from "./visual/ProjectShelf";
import VisualMessage from "./visual/VisualMessage";
import TaskEventSummary from "./visual/TaskEventSummary";
import type { AgentProfile } from "@/lib/server/agents";
import type { InspirationItem } from "@/lib/server/inspiration";
import type { SheetSyncResult } from "@/lib/server/inspiration/sheets-sync";
import {
  emptyDraft,
  useComposerDraft,
  type ComposerDraft,
  type Upload,
} from "./useComposerDraft";
import {
  readPreference,
  writePreference,
  removeLegacyPreference,
} from "@/lib/client/storage";

type Project = { id: string; name: string };
type RemoteHistory = Array<{ role: string; content: string; name?: string }>;
type Workspace = {
  conversations: Conversation[];
  projects: Project[];
  materials: Material[];
  imageInput: boolean;
  memory: { status: string; scope: string; synced: boolean };
};
type Preferences = {
  font: number;
  width: number;
  compact: boolean;
  turtle: boolean;
  animation: boolean;
  turtleSize: number;
};
const DEFAULT_PREFS: Preferences = {
  font: 16,
  width: 780,
  compact: false,
  turtle: true,
  animation: true,
  turtleSize: 100,
};
const EMPTY: Workspace = {
  conversations: [],
  projects: [],
  materials: [],
  imageInput: false,
  memory: {
    status: "unsupported",
    scope: "尚未同步 Hermes 記憶。",
    synced: false,
  },
};
const taskLabels: Record<string, string> = {
  queued: "準備提交",
  running: "執行中",
  waiting_user: "等待確認",
  stopping: "停止確認中",
  completed: "已完成",
  failed: "失敗",
  cancelled: "已停止",
  uncertain: "結果待確認",
};
const connectionLabels: Record<string, string> = {
  unconfigured: "未設定",
  awaiting_authorization: "待授權",
  verifying: "驗證中",
  available: "可用",
  partial: "部分可用",
  failed: "失敗",
};
const isActive = (task: Task) =>
  ["queued", "running", "waiting_user", "stopping"].includes(task.state);
const time = (value: string) =>
  new Date(value).toLocaleString("zh-TW", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch("/api/" + path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  }).catch(() => {
    throw new Error(
      method === "GET"
        ? "暫時無法取得資料，請檢查連線後重試。"
        : "未收到操作結果。請先查看已保存的任務或素材，再決定是否重試。",
    );
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(data.error?.message || "操作失敗，請稍後重試。");
  return data as T;
}
export default function HermesConsole() {
  // NOTE: Full file content is large; this is a truncated upload attempt.
  // Real full content must be provided.
  return null;
}
