"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  Check,
  ChevronDown,
  Copy,
  Folder,
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
  X,
  Link as LinkIcon,
} from "lucide-react";
import type { Conversation, Health, Material, Task } from "@/lib/contracts";
import type { Integration } from "@/lib/server/integrations";
import type { Workflow } from "@/lib/server/workflows";
import MessageBody from "./MessageBody";
import HermesCore from "./visual/HermesCore";
import QuickActions from "./visual/QuickActions";
import AgentOrbit from "./visual/AgentOrbit";
import AgentActivity from "./visual/AgentActivity";
import VisualStatus from "./visual/VisualStatus";
import AppDock from "./visual/AppDock";
import ArtifactDeck from "./visual/ArtifactDeck";
import {
  OFFLINE_NOTICE,
  composerTaskPillAction,
} from "./visual/ComposerTaskStatus";
import Composer from "./console/Composer";
import MaterialThumb from "./visual/MaterialThumb";
import ProjectShelf from "./visual/ProjectShelf";
import VisualMessage from "./visual/VisualMessage";
import PreviewPanel from "./console/PreviewPanel";
import TaskSheet from "./console/TaskSheet";
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
import {
  applyShellMetrics,
  detectComposerKeyboard,
  readViewportFrame,
  shellMetrics,
  widthChanged,
} from "@/lib/client/viewport";
import { consoleApi as api } from "@/lib/client/console-api";
import { taskPollDelayMs } from "@/lib/client/task-poll";
import {
  connectionLabels,
  formatWorkspaceTime,
  isActiveTask,
  taskLabels,
} from "@/lib/client/workspace-ui";
import { useAuthOptional } from "./auth/AuthProvider";
import { useSpatialMode } from "./visual/useSpatialMode";

const ProjectWorkbench = dynamic(() => import("./ProjectWorkbench"));
const InspirationBoard = dynamic(
  () => import("./inspiration/InspirationBoard"),
);
const KnowledgeArchive = dynamic(
  () => import("./knowledge/KnowledgeArchive"),
);
const RuntimeInspector = dynamic(() => import("./RuntimeInspector"));
const AgentPanel = dynamic(() => import("./agents/AgentPanel"));
const SpatialPanel = dynamic(() => import("./visual/SpatialPanel"));
const SettingsPanel = dynamic(() => import("./settings/SettingsPanel"));

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
const isActive = isActiveTask;
const time = formatWorkspaceTime;
export default function HermesConsole() {
  const account = useAuthOptional();
  const [auth, setAuth] = useState<"loading" | "ready">("loading");
  const [data, setData] = useState<Workspace>(EMPTY);
  const [health, setHealth] = useState<Health | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [canvaConfigured, setCanvaConfigured] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [project, setProject] = useState("personal");
  const [nav, setNav] = useState<
    "chat" | "projects" | "inspiration" | "agents" | "tasks"
  >("chat");
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [inspiration, setInspiration] = useState<InspirationItem[]>([]);
  const [sheetsSync, setSheetsSync] = useState<SheetSyncResult | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [sidebar, setSidebar] = useState(false);
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [panel, setPanel] = useState<"settings" | "task" | "preview" | "spatial" | null>(
    null,
  );
  const [settingsTab, setSettingsTab] = useState("外觀");
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [preview, setPreview] = useState<Material | null>(null);
  const draftScope = activeId
    ? "conversation:" + activeId
    : "project:" + project;
  const {
    text,
    setText,
    uploads,
    setUploads,
    references,
    setReferences,
    draft,
    replaceDraft,
    clearDrafts,
  } = useComposerDraft(draftScope);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [offline, setOffline] = useState(false);
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFS);
  const spatial = useSpatialMode(prefs.animation);
  const [radialOpen, setRadialOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [legacy, setLegacy] = useState(false);
  const [newProject, setNewProject] = useState("");
  const [refURL, setRefURL] = useState("");
  const [refTitle, setRefTitle] = useState("");
  const [search, setSearch] = useState("");
  const [jump, setJump] = useState(false);
  const [historySnapshot, setHistorySnapshot] = useState<{
    conversationId: string | null;
    messages: RemoteHistory;
  } | null>(null);
  const remoteHistory =
    historySnapshot?.conversationId === activeId
      ? historySnapshot.messages
      : null;
  function setRemoteHistory(messages: RemoteHistory | null) {
    // A late history response may only be shown for the conversation that requested it.
    setHistorySnapshot(
      messages ? { conversationId: activeId, messages } : null,
    );
  }
  const dialog = useRef<HTMLDialogElement>(null);
  const mobileNav = useRef<HTMLDialogElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const nearBottom = useRef(true);
  const composing = useRef(false);
  const requestKey = useRef<{ payload: string; key: string } | null>(null);
  const pendingXHR = useRef(new Map<string, XMLHttpRequest>());
  const activeConv = data.conversations.find((c) => c.id === activeId);
  const currentTasks = tasks.filter((t) => t.conversationId === activeId);
  const currentTask = currentTasks[0];
  const pending = currentTasks.find(isActive);
  const uncertain = currentTasks.find((t) => t.state === "uncertain");
  const hasActiveTask = busy || currentTasks.some(isActive);
  const chosenTask = tasks.find((t) => t.id === selectedTask) || currentTask;
  const blocked = currentTasks.some(
    (t) => isActive(t) || t.state === "uncertain",
  );

  const loadWorkspace = useCallback(async () => {
    const result = await api<Workspace>("workspace");
    setData(result);
    return result;
  }, []);
  const refresh = useCallback(async () => {
    const [workspace, taskResult, workflowResult] = await Promise.all([
      api<Workspace>("workspace"),
      api<{ tasks: Task[] }>("tasks"),
      api<{ workflows: Workflow[] }>("workflows"),
    ]);
    setData(workspace);
    setTasks(taskResult.tasks);
    setWorkflows(workflowResult.workflows);
    setOffline(false);
  }, []);
  useEffect(() => {
    // Remove compromised legacy connection cache; never remove conversation history.
    for (const key of [
      "hermes.apiKey",
      "hermes.apiUrl",
      "hermes.apiKey.session",
      "hermes.baseUrl",
    ]) {
      removeLegacyPreference(key);
    }
    try {
      const saved = JSON.parse(readPreference("hermes.ui.v2") || "{}");
      setPrefs({
        ...DEFAULT_PREFS,
        font: [14, 16, 18, 20].includes(saved.font) ? saved.font : 16,
        width: [680, 780, 920].includes(saved.width) ? saved.width : 780,
        compact: !!saved.compact,
        turtle: saved.turtle !== false,
        animation: saved.animation !== false,
        turtleSize: [72, 100, 128].includes(saved.turtleSize)
          ? saved.turtleSize
          : 100,
      });
      setLegacy(!!readPreference("hermes.conversations"));
    } catch {}
    setHydrated(true);
    loadWorkspace()
      .then((workspace) => {
        setAuth("ready");
        const saved = readPreference("hermes.active.v2");
        const conv = workspace.conversations.find((c) => c.id === saved);
        if (conv) {
          setActiveId(conv.id);
          setProject(conv.projectId);
        }
      })
      .catch((e) => {
        setAuth("ready");
        setError((e as Error).message);
      });
  }, [loadWorkspace]);
  useEffect(() => {
    if (hydrated) writePreference("hermes.ui.v2", JSON.stringify(prefs));
  }, [prefs, hydrated]);
  useEffect(() => {
    if (auth !== "ready") return;
    api<Health>("health")
      .then(setHealth)
      .catch((e) => setError(e.message));
    api<{ integrations: Integration[]; canva: { configured: boolean } }>(
      "integrations",
    )
      .then((r) => {
        setIntegrations(r.integrations);
        setCanvaConfigured(r.canva.configured);
      })
      .catch(() => {});
    let stopped = false,
      loading = false;
    const poll = async () => {
      if (loading || document.hidden || stopped) return;
      loading = true;
      try {
        await refresh();
      } catch {
        if (!stopped) setOffline(true);
      } finally {
        loading = false;
      }
    };
    void poll();
    let timer = 0 as unknown as ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        void poll().finally(() => {
          if (!stopped) schedule();
        });
      }, taskPollDelayMs(hasActiveTask));
    };
    schedule();
    const disconnected = () => setOffline(true);
    window.addEventListener("online", poll);
    window.addEventListener("offline", disconnected);
    document.addEventListener("visibilitychange", poll);
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener("online", poll);
      window.removeEventListener("offline", disconnected);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [auth, refresh, hasActiveTask]);
  useEffect(() => {
    const viewport = window.visualViewport;
    let baselineHeight = viewport?.height || window.innerHeight;
    let previousWidth = viewport?.width || window.innerWidth;
    let frame = 0;
    const update = () => {
      const current = readViewportFrame(viewport, window);
      const composerFocused = document.activeElement === input.current;
      const rotated = widthChanged(previousWidth, current.width);
      if (!composerFocused || rotated || current.height > baselineHeight) {
        baselineHeight = current.innerHeight;
      }
      previousWidth = current.width;
      applyShellMetrics(
        document.documentElement,
        shellMetrics(
          current,
          detectComposerKeyboard({
            composerFocused,
            widthChanged: rotated,
            frame: current,
            baselineHeight,
          }),
        ),
      );
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    update();
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    document.addEventListener("focusin", schedule);
    document.addEventListener("focusout", schedule);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("focusin", schedule);
      document.removeEventListener("focusout", schedule);
      applyShellMetrics(document.documentElement, {
        height: null,
        offsetTop: 0,
        keyboardOpen: false,
      });
    };
  }, []);
  useEffect(() => {
    if (panel) dialog.current?.showModal();
    else dialog.current?.close();
  }, [panel]);
  const previousPanel = useRef(panel);
  useEffect(() => {
    const was = previousPanel.current;
    previousPanel.current = panel;
    if (was === "task" && !panel) {
      // Chat-first: closing task sheet returns focus to composer.
      const frame = requestAnimationFrame(() => input.current?.focus());
      return () => cancelAnimationFrame(frame);
    }
  }, [panel]);
  useEffect(() => {
    if (!panel) return;
    const frame = requestAnimationFrame(() => {
      dialog.current?.scrollTo({ top: 0, behavior: "auto" });
      dialog.current
        ?.querySelector<HTMLElement>(".panel-content")
        ?.scrollTo({ top: 0, behavior: "auto" });
    });
    return () => cancelAnimationFrame(frame);
  }, [panel, preview, selectedTask, settingsTab]);
  useEffect(() => {
    if (drawer) mobileNav.current?.showModal();
    else mobileNav.current?.close();
  }, [drawer]);
  useEffect(() => {
    if (nearBottom.current) {
      const el = scroll.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [activeConv?.messages.length, currentTask?.output]);
  useEffect(() => {
    nearBottom.current = true;
    setJump(false);
    if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [activeId]);
  useEffect(
    () => () => {
      for (const xhr of pendingXHR.current.values()) xhr.abort();
    },
    [],
  );
  function selectConversation(conv: Conversation) {
    if (busy) return;
    setRemoteHistory(null);
    setActiveId(conv.id);
    setProject(conv.projectId);
    setNav("chat");
    setDrawer(false);
    setError("");
    writePreference("hermes.active.v2", conv.id);
  }
  function fresh() {
    if (busy) return;
    setRemoteHistory(null);
    setActiveId(null);
    setNav("chat");
    setDrawer(false);
    setError("");
    writePreference("hermes.active.v2", null);
    input.current?.focus();
  }
  async function createConversation(
    title: string,
    parentId?: string,
    beforeMessageId?: string,
    initialDraft: ComposerDraft = draft,
  ) {
    const result = await api<{ conversation: Conversation }>(
      "conversations",
      "POST",
      {
        title: title.slice(0, 60),
        projectId: project,
        parentId,
        beforeMessageId,
      },
    );
    replaceDraft("conversation:" + result.conversation.id, initialDraft);
    setRemoteHistory(null);
    if (!parentId) replaceDraft(draftScope, emptyDraft());
    setActiveId(result.conversation.id);
    writePreference("hermes.active.v2", result.conversation.id);
    await loadWorkspace();
    return result.conversation;
  }
  async function send() {
    if (busy || blocked || !text.trim() || uploads.some((u) => !u.material))
      return;
    setBusy(true);
    setError("");
    nearBottom.current = true;
    try {
      const conv = activeConv || (await createConversation(text.trim()));
      const payload = {
        conversationId: conv.id,
        input: text.trim(),
        attachments: [
          ...uploads.flatMap((u) => (u.material ? [u.material.id] : [])),
          ...references,
        ],
      };
      const signature = JSON.stringify(payload);
      if (requestKey.current?.payload !== signature)
        requestKey.current = { payload: signature, key: crypto.randomUUID() };
      const result = await api<{ task: Task }>("tasks", "POST", {
        ...payload,
        requestKey: requestKey.current.key,
      });
      setTasks((previous) => [
        result.task,
        ...previous.filter((t) => t.id !== result.task.id),
      ]);
      replaceDraft("conversation:" + conv.id, emptyDraft());
      requestKey.current = null;
      await refresh();
      input.current?.focus();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function stopTask(task: Task) {
    try {
      const result = await api<{ task: Task }>("tasks", "PATCH", {
        id: task.id,
        action: "stop",
      });
      setTasks((old) => old.map((t) => (t.id === task.id ? result.task : t)));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function acknowledgeTask(task: Task) {
    try {
      const result = await api<{ task: Task }>("tasks", "PATCH", {
        id: task.id,
        action: "acknowledge",
      });
      setTasks((old) => old.map((t) => (t.id === task.id ? result.task : t)));
      setError("");
      setNotice("已確認此待確認結果，可以重新送出；未宣稱遠端已停止。");
      input.current?.focus();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  /** Fork a new conversation from the user message that started this task. */
  function retryBranchFromTask(task: Task) {
    const conv =
      data.conversations.find((c) => c.id === task.conversationId) ||
      activeConv;
    if (!conv) {
      setError("找不到對應對話，無法建立重試分支。");
      return;
    }
    const message = conv.messages.find(
      (m) => m.taskId === task.id && m.role === "user",
    );
    if (!message) {
      setError("找不到觸發此任務的使用者訊息，無法建立重試分支。");
      return;
    }
    if (activeId !== conv.id) {
      setActiveId(conv.id);
      setProject(conv.projectId);
    }
    void branch(message.id, message.content, conv);
  }
  async function branch(
    messageId: string,
    content: string,
    source = activeConv,
  ) {
    if (!source) return;
    setBusy(true);
    try {
      await createConversation(
        source.title + " · 分支",
        source.id,
        messageId,
        {
          text: content,
          uploads: [],
          references:
            source.messages.find((m) => m.id === messageId)?.attachments ||
            [],
        },
      );
      setNav("chat");
      setPanel(null);
      setNotice("已建立分支，原對話完整保留。修改內容後再送出。");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice("已複製。");
    } catch {
      setError("無法取得剪貼簿權限，請選取文字複製。");
    }
  }
  function download(task: Task) {
    const url = URL.createObjectURL(
      new Blob([task.output], { type: "text/markdown;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "hermes-" + task.id + ".md";
    anchor.click();
    URL.revokeObjectURL(url);
  }
  function openTask(task?: Task) {
    setSelectedTask(task?.id || null);
    setPanel("task");
  }
  function useDirection(prompt: string) {
    setText(prompt);
    setNav("chat");
    input.current?.focus();
  }
  function continueDesign(id: string) {
    setNav("chat");
    setText("請查回創作流程 " + id + " 的現有設計，接續修改同一作品。");
    input.current?.focus();
  }
  async function pickDirection(workflowId: string, index: number, title: string) {
    try {
      await api("workflows", "PATCH", { id: workflowId, selected: index });
      await refresh();
      useDirection(
        "已選定「" +
          title.slice(0, 40) +
          "」。請依這個方向製作草稿，沿用創作流程 " +
          workflowId +
          " 第 " +
          (index + 1) +
          " 個方向，不要另起無關作品。",
      );
    } catch (error) {
      setError((error as Error).message);
    }
  }
  function openMaterial(materialId: string) {
    const asset = data.materials.find((item) => item.id === materialId);
    if (!asset) return;
    setPreview(asset);
    setPanel("preview");
  }
  function closePanel() {
    setPanel(null);
  }
  function onComposerTaskPillClick(task: Task) {
    // Offline: refresh only — never open-resend or acknowledge.
    if (composerTaskPillAction(offline) === "refresh") {
      void refresh().catch(() => setOffline(true));
      return;
    }
    openTask(task);
  }
  function uploadFile(file: File, key = crypto.randomUUID()) {
    if (file.size > 8_000_000) {
      setError("每個檔案上限 8 MB。");
      return;
    }
    const record: Upload = { key, file, progress: 0, error: null };
    setUploads((old) => [...old.filter((u) => u.key !== key), record]);
    const xhr = new XMLHttpRequest();
    pendingXHR.current.set(key, xhr);
    xhr.open("POST", "/api/materials?projectId=" + encodeURIComponent(project));
    xhr.setRequestHeader("Content-Type", file.type || "text/plain");
    xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        setUploads((old) =>
          old.map((u) =>
            u.key === key
              ? {
                  ...u,
                  progress: Math.round((event.loaded / event.total) * 100),
                }
              : u,
          ),
        );
    };
    const fail = (message: string) => {
      pendingXHR.current.delete(key);
      setUploads((old) =>
        old.map((u) => (u.key === key ? { ...u, error: message } : u)),
      );
    };
    xhr.timeout = 120_000;
    xhr.ontimeout = () => fail("上傳逾時，請移除或重試。");
    xhr.onabort = () => pendingXHR.current.delete(key);
    xhr.onerror = () => fail("上傳中斷，請重試。");
    xhr.onload = () => {
      pendingXHR.current.delete(key);
      try {
        const result = JSON.parse(xhr.responseText);
        if (xhr.status === 401)
          window.dispatchEvent(new Event("hermes-session-expired"));
        if (xhr.status >= 400) {
          fail(result.error?.message || "上傳失敗");
          return;
        }
        setUploads((old) =>
          old.map((u) =>
            u.key === key
              ? { ...u, progress: 100, material: result.material }
              : u,
          ),
        );
        void loadWorkspace().catch(() => {});
      } catch {
        fail("回應格式錯誤，請重試。");
      }
    };
    xhr.send(file);
  }
  async function importLegacy() {
    try {
      const raw = readPreference("hermes.conversations");
      if (!raw) return;
      const result = await api<{ imported: number; notice: string }>(
        "conversations",
        "PUT",
        JSON.parse(raw),
      );
      setNotice(result.notice + "（" + result.imported + " 筆）");
      setLegacy(false);
      await loadWorkspace();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const navigate = (next: typeof nav) => {
    setNav(next);
    setDrawer(false);
    if (next === "agents")
      api<{ agents: AgentProfile[] }>("agents")
        .then((result) => setAgents(result.agents))
        .catch(() => {});
    if (next === "inspiration")
      api<{ items: InspirationItem[]; sheetsSync: SheetSyncResult | null }>(
        "inspiration",
      )
        .then((result) => {
          setInspiration(result.items);
          setSheetsSync(result.sheetsSync);
        })
        .catch(() => {});
  };
  const navigation = (
    <>
      <div className="brand" role="img" aria-label="Hermes 龜龜創作助手">
        <span className="brand-mark">
          <Leaf size={20} />
        </span>
        <span className="brand-copy">
          Hermes<small>龜龜創作助手</small>
        </span>
      </div>
      <button
        className="new-chat"
        aria-label="開啟新對話"
        onClick={fresh}
        disabled={busy}
      >
        <Plus size={19} />
        <span>開啟新對話</span>
        <Pencil size={16} />
      </button>
      <nav className="visual-dock-nav" aria-label="主要導覽">
        <button
          aria-label="對話"
          title="對話"
          aria-current={nav === "chat" ? "page" : undefined}
          onClick={() => navigate("chat")}
        >
          <MessageSquare size={19} />
          <span>對話</span>
        </button>
        <button
          aria-label="專案"
          title="專案"
          aria-current={nav === "projects" ? "page" : undefined}
          onClick={() => navigate("projects")}
        >
          <Images size={19} />
          <span>專案</span>
        </button>
        <button
          aria-label="靈感"
          title="靈感"
          aria-current={nav === "inspiration" ? "page" : undefined}
          onClick={() => navigate("inspiration")}
        >
          <Sparkles size={19} />
          <span>靈感</span>
        </button>
        <button
          aria-label="Agent"
          title="Agent"
          aria-current={nav === "agents" ? "page" : undefined}
          onClick={() => navigate("agents")}
        >
          <Bot size={19} />
          <span>Agent</span>
        </button>
        <button
          aria-current={nav === "tasks" ? "page" : undefined}
          onClick={() => navigate("tasks")}
        >
          <ListTodo size={19} />
          任務
        </button>
      </nav>
      <div className="side-section dock-section-label">
        <span>專案</span>
        <button
          aria-label="新增專案"
          onClick={() => {
            setPanel("settings");
            setSettingsTab("工作區");
            setDrawer(false);
          }}
        >
          <Plus size={17} />
        </button>
      </div>
      <button
        className={"project-row " + (project === "personal" ? "selected" : "")}
        disabled={busy}
        onClick={() => {
          setProject("personal");
          fresh();
        }}
      >
        <Folder size={17} />
        <span>個人工作區</span>
      </button>
      {data.projects.map((p) => (
        <button
          key={p.id}
          className={"project-row " + (project === p.id ? "selected" : "")}
          disabled={busy}
          onClick={() => {
            setProject(p.id);
            fresh();
          }}
        >
          <Folder size={17} />
          <span>{p.name}</span>
        </button>
      ))}
      <div className="side-section dock-section-label">
        <span>最近對話</span>
      </div>
      <div className="history">
        {data.conversations
          .filter((c) => c.projectId === project)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .map((c) => (
            <button
              key={c.id}
              disabled={busy}
              aria-current={activeId === c.id ? "true" : undefined}
              onClick={() => selectConversation(c)}
              title={c.title}
            >
              {c.title}
            </button>
          ))}
        {!data.conversations.some((c) => c.projectId === project) && (
          <p className="quiet">你的想法，從這裡開始。</p>
        )}
      </div>
      <button
        className="settings-button"
        aria-label="設定與連線"
        title="設定與連線"
        onClick={() => {
          setPanel("settings");
          setDrawer(false);
        }}
      >
        <Settings size={19} />
        <span>設定與連線</span>
        <span
          className={
            "status-dot " + (health?.credential === "valid" ? "good" : "")
          }
        />
      </button>
    </>
  );

  return (
    <div
      className={"app-shell " + (!sidebar ? "sidebar-closed" : "")}
      style={
        {
          "--reading-width": prefs.width + "px",
          "--font-size": prefs.font + "px",
        } as React.CSSProperties
      }
      data-compact={prefs.compact}
      data-spatial={spatial.mode}
      data-page-visible={spatial.visible}
      data-sheet-open={!!panel || drawer || radialOpen}
      data-scroll-owner={nav === "chat" ? "conversation" : "page"}
    >
      <a className="skip-link" href="#composer">
        跳至輸入區
      </a>
      <aside className="sidebar" data-expanded={sidebar}>
        {navigation}
      </aside>
      <dialog
        ref={mobileNav}
        className="mobile-nav"
        aria-label="工作區導覽"
        onCancel={() => setDrawer(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setDrawer(false);
        }}
      >
        <div className="drawer-content">
          <button
            className="close-drawer icon-button"
            aria-label="關閉導覽"
            onClick={() => setDrawer(false)}
          >
            <X />
          </button>
          {navigation}
        </div>
      </dialog>
      <main className="workspace-main">
        <header className="topbar">
          <button
            className="icon-button desktop-toggle"
            aria-label={sidebar ? "收合側欄" : "展開側欄"}
            aria-expanded={sidebar}
            onClick={() => setSidebar(!sidebar)}
          >
            {sidebar ? <PanelLeftClose size={20} /> : <Menu size={20} />}
          </button>
          <button
            className="icon-button mobile-toggle"
            aria-label="開啟導覽"
            onClick={() => setDrawer(true)}
          >
            <Menu size={21} />
          </button>
          <div className="topbar-title">
            {nav === "chat"
              ? spatial.mobile ? "Hermes" : "創作對話"
              : nav === "projects"
                ? "專案與素材"
                : nav === "inspiration"
                  ? "靈感"
                  : nav === "tasks"
                    ? "任務"
                    : "Agent"}
            <span>
              {data.projects.find((p) => p.id === project)?.name ||
                "個人工作區"}
            </span>
          </div>
          <button
            className="icon-button"
            aria-label="任務與成果"
            title="任務與成果"
            onClick={() => navigate("tasks")}
          >
            <ListTodo size={20} />
          </button>
          <button
            className="connection-pill"
            aria-label={
              "連線狀態：" +
              (offline
                ? "離線"
                : health
                  ? connectionLabels[health.status]
                  : "確認中")
            }
            onClick={() => {
              setSettingsTab("連線");
              setPanel("settings");
            }}
          >
            <span
              className={
                "status-dot " + (health?.credential === "valid" ? "good" : "")
              }
            />
            <span className="connection-label">
              {offline
                ? "離線"
                : health
                  ? connectionLabels[health.status]
                  : "確認連線"}
            </span>
          </button>
          <button
            className="icon-button account-chip"
            aria-label="帳號設定"
            onClick={() => {
              setSettingsTab("帳號");
              setPanel("settings");
            }}
          >
            {account?.user?.avatar ? (
              <img src={account.user.avatar} alt="" width={28} height={28} />
            ) : (
              <span aria-hidden="true">
                {(account?.user?.name || "H").slice(0, 1)}
              </span>
            )}
          </button>
          <button
            className="icon-button"
            aria-label="外觀設定"
            onClick={() => {
              setSettingsTab("外觀");
              setPanel("settings");
            }}
          >
            <Settings size={19} />
          </button>
        </header>
        {(error || notice || offline) && (
          <div
            className={"notice-bar " + (error || offline ? "warning" : "")}
            role={error ? "alert" : "status"}
          >
            <span>
              {error ||
                (offline ? OFFLINE_NOTICE : notice)}
            </span>
            {!offline && (
              <button
                className="icon-button"
                aria-label="關閉提示"
                onClick={() => {
                  setError("");
                  setNotice("");
                }}
              >
                <X size={16} />
              </button>
            )}
          </div>
        )}
        {nav === "chat" ? (
          <>
            <div
              className="conversation-scroll"
              ref={scroll}
              onScroll={(e) => {
                const el = e.currentTarget;
                nearBottom.current =
                  el.scrollHeight - el.scrollTop - el.clientHeight < 100;
                setJump(!nearBottom.current);
              }}
            >
              <div className="conversation" key={activeId || "new"}>
                {!activeConv?.messages.length ? (
                  <section className="welcome" aria-labelledby="welcome-title">
                    <div className="welcome-stage">
                      {prefs.turtle && (
                        <HermesCore
                          task={currentTask}
                          offline={offline}
                          animation={prefs.animation}
                          size={prefs.turtleSize * 1.8}
                          onClick={() => setPanel("spatial")}
                        />
                      )}
                      {prefs.turtle && (
                        <AgentOrbit
                          compact
                          task={currentTask}
                          integrations={integrations}
                          stale={offline}
                          animation={prefs.animation}
                        />
                      )}
                    </div>
                    <h1 id="welcome-title">今天想做什麼？</h1>
                    <QuickActions
                      mobile={spatial.mobile}
                      onSelect={(prompt) => {
                        setText(prompt);
                        input.current?.focus();
                      }}
                    />
                    {legacy && (
                      <button className="text-button" onClick={importLegacy}>
                        匯入這個瀏覽器中的舊對話（不覆蓋原資料）
                      </button>
                    )}
                  </section>
                ) : (
                  <>
                    {activeConv.parentId && (
                      <p className="branch-note">
                        此為獨立分支，原對話仍保留。
                      </p>
                    )}
                    {currentTask && isActive(currentTask) && (
                      <AgentActivity
                        task={currentTask}
                        onInspect={() => openTask(currentTask)}
                      />
                    )}
                    {activeConv.messages.map((message) => (
                      <article
                        key={message.id}
                        className={"message " + message.role}
                      >
                        <div className="message-byline">
                          {message.role === "user" ? "你" : "Hermes"}
                          <time dateTime={message.createdAt}>
                            {time(message.createdAt)}
                          </time>
                          {message.provenance === "legacy_unverified" && (
                            <span>舊資料 · 未驗證</span>
                          )}
                        </div>
                        <div className="message-content">
                          <MessageBody text={message.content} />
                          {message.role === "assistant" && message.taskId && (
                            <VisualMessage
                              task={tasks.find((t) => t.id === message.taskId)}
                              onInspect={() =>
                                openTask(
                                  tasks.find((t) => t.id === message.taskId),
                                )
                              }
                              onUseDirection={useDirection}
                              onOpenMaterial={openMaterial}
                              onPickDirection={(id, index, title) => {
                                void pickDirection(id, index, title);
                              }}
                              onContinueDesign={continueDesign}
                            />
                          )}
                          {!!message.attachments?.length && (
                            <div className="message-attachments">
                              {message.attachments.map((id) => {
                                const asset = data.materials.find(
                                  (m) => m.id === id,
                                );
                                return asset ? (
                                  <button
                                    key={id}
                                    onClick={() => {
                                      setPreview(asset);
                                      setPanel("preview");
                                    }}
                                  >
                                    {asset.kind === "image" ||
                                    asset.mime === "application/pdf" ||
                                    asset.kind === "reference" ? (
                                      <MaterialThumb
                                        material={asset}
                                        alt={asset.title}
                                      />
                                    ) : null}
                                    <span>{asset.title}</span>
                                  </button>
                                ) : null;
                              })}
                            </div>
                          )}
                        </div>
                        <div className="message-actions">
                          <button
                            aria-label="複製訊息"
                            onClick={() => copy(message.content)}
                          >
                            <Copy size={15} />
                          </button>
                          {message.role === "user" && (
                            <button
                              aria-label="編輯並建立分支"
                              onClick={() =>
                                branch(message.id, message.content)
                              }
                              disabled={busy}
                            >
                              <Pencil size={15} />
                            </button>
                          )}
                          {message.taskId && message.role === "assistant" && (
                            <button
                              onClick={() =>
                                openTask(
                                  tasks.find((t) => t.id === message.taskId),
                                )
                              }
                            >
                              執行紀錄
                            </button>
                          )}
                        </div>
                      </article>
                    ))}
                    {currentTask &&
                      !activeConv.messages.some(
                        (m) =>
                          m.taskId === currentTask.id && m.role === "assistant",
                      ) && (
                        <article className="message assistant">
                          <div className="message-byline">
                            Hermes
                            <span className="task-status">
                              {taskLabels[currentTask.state]}
                            </span>
                          </div>
                          {currentTask.output && (
                            <MessageBody text={currentTask.output} />
                          )}
                          <VisualMessage
                            task={currentTask}
                            onInspect={() => openTask(currentTask)}
                            onUseDirection={useDirection}
                            onOpenMaterial={openMaterial}
                            onPickDirection={(id, index, title) => {
                              void pickDirection(id, index, title);
                            }}
                            onContinueDesign={continueDesign}
                          />
                          {currentTask.error && (
                            <p className="error">{currentTask.error}</p>
                          )}
                          {currentTask.observationError && (
                            <p className="error">
                              {currentTask.observationError}
                            </p>
                          )}
                          <button
                            className="task-summary"
                            onClick={() => openTask(currentTask)}
                          >
                            <ListTodo size={16} />
                            {currentTask.events.at(-1)?.summary ||
                              "查看已保存的任務"}
                            <ChevronDown size={16} />
                          </button>
                          {["failed", "cancelled", "uncertain"].includes(
                            currentTask.state,
                          ) && (
                            <button
                              className="text-button"
                              onClick={() => retryBranchFromTask(currentTask)}
                            >
                              建立重試分支（保留原紀錄）
                            </button>
                          )}
                          {currentTask.state === "uncertain" && (
                            <button
                              className="text-button"
                              onClick={() => void acknowledgeTask(currentTask)}
                            >
                              確認並可重試
                            </button>
                          )}
                        </article>
                      )}
                  </>
                )}
              </div>
            </div>
            <Composer
              jump={jump}
              onJumpLatest={() => {
                nearBottom.current = true;
                setJump(false);
                scroll.current?.scrollTo({
                  top: scroll.current.scrollHeight,
                  behavior: "auto",
                });
              }}
              task={currentTask}
              offline={offline}
              onTaskPillClick={onComposerTaskPillClick}
              uncertain={uncertain}
              onAcknowledge={(item) => void acknowledgeTask(item)}
              onRetryBranch={retryBranchFromTask}
              busy={busy}
              blocked={blocked}
              pending={pending}
              turtle={{
                shown: prefs.turtle && !!activeConv?.messages.length,
                size: prefs.turtleSize,
                animation: prefs.animation,
              }}
              text={text}
              setText={setText}
              uploads={uploads}
              references={references}
              materials={data.materials}
              inputRef={input}
              uploadInputRef={uploadInput}
              composingRef={composing}
              onSend={() => void send()}
              onStop={(item) => void stopTask(item)}
              onFiles={(files) => {
                if (files.length + uploads.length + references.length > 4) {
                  setError("每則訊息最多四個附件。");
                  return;
                }
                files.forEach((file) => uploadFile(file));
              }}
              onPreview={(material) => {
                setPreview(material);
                setPanel("preview");
              }}
              onRetryUpload={(upload) => uploadFile(upload.file, upload.key)}
              onRemoveUpload={(key) => {
                pendingXHR.current.get(key)?.abort();
                setUploads((old) => old.filter((u) => u.key !== key));
              }}
              onRemoveReference={(id) =>
                setReferences((old) => old.filter((value) => value !== id))
              }
              onNavigate={(kind) => {
                if (kind === "canva") {
                  setText("請查回我已有的 Canva 設計，選擇要接續修改的作品。");
                  input.current?.focus();
                } else {
                  setNav("projects");
                  setReferenceOpen(kind === "reference");
                }
              }}
            />
          </>
        ) : nav === "projects" ? (
          <section className="secondary-page page-scroll">
            <h1>素材與靈感</h1>
            <ProjectShelf
              projects={data.projects}
              materials={data.materials}
              conversations={data.conversations}
              selected={project}
              onSelect={(id) => {
                setProject(id);
                setActiveId(null);
              }}
              onCreate={() => {
                setPanel("settings");
                setSettingsTab("工作區");
              }}
            />
            <details className="workbench-disclosure">
              <summary>活動與文案</summary>
              <ProjectWorkbench
                key={project}
                projectId={project}
                materials={data.materials}
                workflows={workflows}
                onCompose={(text) => {
                  if (busy) {
                    setError("請先等目前任務結束或停止，再接續其他作品。");
                    return;
                  }
                  fresh();
                  replaceDraft("project:" + project, { ...emptyDraft(), text });
                }}
              />
            </details>
            <details
              className="reference-disclosure"
              open={referenceOpen}
              onToggle={(e) => setReferenceOpen(e.currentTarget.open)}
            >
              <summary>收藏參考連結</summary>
              <form
                className="reference-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await api("materials", "POST", {
                      projectId: project,
                      title: refTitle,
                      url: refURL,
                    });
                    setRefTitle("");
                    setRefURL("");
                    await loadWorkspace();
                    setNotice("已保存來源連結；尚未擷取網頁內容。");
                  } catch (err) {
                    setError((err as Error).message);
                  }
                }}
              >
                <label>
                  參考標題
                  <input
                    required
                    maxLength={150}
                    value={refTitle}
                    onChange={(e) => setRefTitle(e.target.value)}
                    placeholder="例如：校園活動構圖參考"
                  />
                </label>
                <label>
                  來源連結
                  <input
                    required
                    type="url"
                    value={refURL}
                    onChange={(e) => setRefURL(e.target.value)}
                    placeholder="https://…"
                  />
                </label>
                <button className="primary">
                  <LinkIcon size={16} />
                  收藏連結
                </button>
              </form>
            </details>
            <div className="material-grid">
              {data.materials
                .filter((m) => m.projectId === project)
                .map((m) => (
                  <article className="material-card" key={m.id}>
                    <button
                      className="material-preview"
                      aria-label={"預覽素材：" + m.title}
                      onClick={() => {
                        setPreview(m);
                        setPanel("preview");
                      }}
                    >
                      {m.kind === "image" ||
                      m.mime === "application/pdf" ||
                      m.kind === "reference" ? (
                        <MaterialThumb material={m} alt={m.title} />
                      ) : (
                        <LinkIcon size={28} />
                      )}
                    </button>
                    <h3>{m.title}</h3>
                    <p>
                      {m.rights === "reference_only"
                        ? "僅供參考 · 權利未確認"
                        : "使用者上傳"}
                    </p>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => {
                        if (references.length + uploads.length >= 4) {
                          setError("每則訊息最多四個附件。");
                          return;
                        }
                        setReferences((old) =>
                          old.includes(m.id) ? old : [...old, m.id],
                        );
                        setNav("chat");
                      }}
                    >
                      加入對話 <Plus size={16} />
                    </button>
                  </article>
                ))}
            </div>
            {!data.materials.some((m) => m.projectId === project) && (
              <div className="empty-state">
                <Images size={30} />
                <h2>靈感板還是一張白紙</h2>
                <p>
                  收藏 Instagram、Pinterest 或其他 HTTPS 來源，
                  <br />
                  也可以從對話輸入區上傳圖片。
                </p>
              </div>
            )}
          </section>
        ) : nav === "inspiration" ? (
          <section className="secondary-page page-scroll" aria-label="靈感">
            <InspirationBoard
              items={inspiration}
              syncStatus={sheetsSync}
              onSync={async () => {
                const result = await api<{ sheetsSync: SheetSyncResult }>(
                  "inspiration",
                  "POST",
                  { action: "sync_sheets" },
                );
                setSheetsSync(result.sheetsSync);
                const [updated, workspace] = await Promise.all([
                  api<{ items: InspirationItem[] }>("inspiration"),
                  api<Workspace>("workspace"),
                ]);
                setInspiration(updated.items);
                setData(workspace);
              }}
              notice="不能搜尋完整 Instagram 或 Pinterest。貼連結、上傳或讓 Hermes 依真實能力研究。"
            />
            <KnowledgeArchive />
          </section>
        ) : nav === "agents" ? (
          <section className="secondary-page page-scroll">
            <div className="page-heading-row">
              <div>
                <p className="eyebrow">能力</p>
                <h1>Agent Runtime</h1>
              </div>
              <VisualStatus health={health} offline={offline} />
            </div>
            <RuntimeInspector
              task={currentTask}
              health={health}
              animation={prefs.animation}
            />
            <details className="agent-profiles">
              <summary>Agent OS · 設定檔</summary>
              <AgentPanel
                agents={agents.filter(
                  (agent) =>
                    agent.role === "general" || agent.status !== "unconfigured",
                )}
                brain={[]}
              />
            </details>
          </section>
        ) : (
          <section className="secondary-page page-scroll">
            <h1>任務</h1>
            <ArtifactDeck items={workflows.filter(w=>w.projectId===project)} onContinue={id=>{setNav("chat");setText("請查回創作流程 "+id+" 的現有設計，接續修改同一作品。");}} onChanged={()=>{void refresh();}} />
            {workflows
              .filter((w) => w.projectId === project)
              .map((w) => (
                <section className="workflow" key={w.id}>
                  <h2>
                    創作方向 ·{" "}
                    {w.selected === null
                      ? "等待你的選擇"
                      : "已選定方向 " + (w.selected + 1)}
                  </h2>
                  <p className="muted">{w.brief}</p>
                  <div className="direction-grid">
                    {w.directions.map((d, index) => (
                      <article
                        key={index}
                        className={
                          "direction " +
                          (w.selected === index ? "selected" : "")
                        }
                      >
                        <span className="eyebrow">方向 0{index + 1}</span>
                        <h3>{d.title}</h3>
                        <p>{d.claim}</p>
                        <details>
                          <summary>視覺、文案與來源</summary>
                          <p>{d.visual}</p>
                          <MessageBody text={d.copy} />
                          <p>{d.cta}</p>
                          {d.sources.map((source) => (
                            <a
                              key={source}
                              href={source}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {source}
                            </a>
                          ))}
                        </details>
                        <button
                          disabled={[
                            "creating",
                            "draft_ready",
                            "uncertain",
                          ].includes(w.state)}
                          onClick={async () => {
                            try {
                              await api("workflows", "PATCH", {
                                id: w.id,
                                selected: index,
                              });
                              await refresh();
                              setText(
                                "已在 Console 選定創作流程 " +
                                  w.id +
                                  " 的第 " +
                                  (index + 1) +
                                  " 個方向。請查詢可用 Canva 範本欄位，依此方向製作草稿；如缺授權請保留阻塞點。",
                              );
                              setNav("chat");
                            } catch (e) {
                              setError((e as Error).message);
                            }
                          }}
                        >
                          {w.selected === index ? (
                            <>
                              <Check size={16} />
                              已選定
                            </>
                          ) : (
                            "選擇這個方向"
                          )}
                        </button>
                      </article>
                    ))}
                  </div>
                  {w.error && <p className="error">{w.error}</p>}
                  {w.canvaJobId && (
                    <button
                      onClick={async () => {
                        try {
                          await api("workflows", "POST", { id: w.id });
                          await refresh();
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    >
                      <RefreshCw size={16} />
                      查回 Canva 製作結果
                    </button>
                  )}

                </section>
              ))}
            {!tasks.some(
              (t) =>
                data.conversations.find((c) => c.id === t.conversationId)
                  ?.projectId === project,
            ) &&
              !workflows.some((w) => w.projectId === project) && (
                <div className="empty-state">
                  <ListTodo size={30} />
                  <h2>目前沒有任務</h2>
                  <p>送出第一則訊息後，便能在這裡查回執行結果。</p>
                </div>
              )}
            {tasks
              .filter(
                (t) =>
                  data.conversations.find((c) => c.id === t.conversationId)
                    ?.projectId === project,
              )
              .map((t) => (
                <button
                  className="task-row"
                  key={t.id}
                  onClick={() => openTask(t)}
                >
                  <span>
                    <strong>{t.input.slice(0, 70)}</strong>
                    <small>{time(t.createdAt)}</small>
                  </span>
                  <span className={"badge " + t.state}>
                    {taskLabels[t.state]}
                  </span>
                </button>
              ))}
          </section>
        )}
      </main>
      <AppDock nav={nav} onNavigate={navigate} busy={busy} onOpenChange={setRadialOpen}
        onAction={action=>{
          if(action==="spatial")setPanel("spatial");
          else if(action==="memory"){setSettingsTab("進階");setPanel("settings");}
          else {setNav("chat");setText("請查回我已有的 Canva 設計，選擇要接續修改的作品。");}
        }}
        onFiles={files=>{
          if(files.length+uploads.length+references.length>4){setError("每則訊息最多四個附件。");return;}
          setNav("chat");files.forEach(file=>uploadFile(file));
        }}
      />
      <dialog
        ref={dialog}
        className={"detail-dialog "+(panel==="spatial"?"spatial-sheet":panel==="preview"?"preview-sheet":"")}
        aria-labelledby="detail-panel-title"
        onCancel={() => setPanel(null)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setPanel(null);
        }}
      >
        <div className="panel-content">
          <header className="panel-header">
            <h2 id="detail-panel-title">
              {panel === "spatial" ? "Hermes 空間" : panel === "settings"
                ? "工作區設定"
                : panel === "preview"
                  ? "素材預覽"
                  : "任務詳情"}
            </h2>
            <button
              className="icon-button"
              aria-label="關閉面板"
              onClick={() => closePanel()}
            >
              <X size={21} />
            </button>
          </header>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {panel === "spatial" ? <SpatialPanel key={project} projectId={project} task={currentTask} integrations={integrations}
            animation={prefs.animation} offline={offline} onTask={()=>openTask(currentTask)}
            onMemory={()=>{setSettingsTab("進階");setPanel("settings");}}
            onNavigate={next=>{setPanel(null);navigate(next);}} /> : panel === "settings" ? (
            <SettingsPanel
              settingsTab={settingsTab}
              onTab={setSettingsTab}
              prefs={prefs}
              onPrefs={setPrefs}
              onResetPrefs={() => setPrefs(DEFAULT_PREFS)}
              health={health}
              onHealth={setHealth}
              busy={busy}
              onBusy={setBusy}
              integrations={integrations}
              onIntegrations={setIntegrations}
              canvaConfigured={canvaConfigured}
              search={search}
              onSearch={setSearch}
              project={project}
              materials={data.materials}
              memoryScope={data.memory.scope}
              conversationId={activeId}
              hermesSessionId={activeConv?.hermesSessionId || null}
              remoteHistory={remoteHistory}
              onRemoteHistory={setRemoteHistory}
              legacy={legacy}
              onImportLegacy={importLegacy}
              tasks={tasks}
              projectCount={data.projects.length}
              newProject={newProject}
              onNewProject={setNewProject}
              onWorkspaceChanged={loadWorkspace}
              onOpenTask={(id) => {
                setSelectedTask(id);
                setPanel("task");
              }}
              onError={setError}
              onNotice={setNotice}
            />
          ) : panel === "preview" && preview ? (
            <PreviewPanel preview={preview} />
          ) : chosenTask ? (
            <TaskSheet
              task={chosenTask}
              offline={offline}
              busy={busy}
              onRefresh={() => void refresh().catch(() => setOffline(true))}
              onAcknowledge={acknowledgeTask}
              onRetryBranch={retryBranchFromTask}
              onStop={stopTask}
              onDownload={download}
              onBackToChat={() => {
                const conversation = data.conversations.find(
                  (item) => item.id === chosenTask.conversationId,
                );
                if (conversation) selectConversation(conversation);
                closePanel();
              }}
            />
          ) : (
            <div className="empty-state">
              <ListTodo size={28} />
              <p>
                尚未開始任務。
                <br />
                龜龜只會顯示真實的執行狀態。
              </p>
            </div>
          )}
        </div>
      </dialog>
    </div>
  );
}
