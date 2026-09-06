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
import CanvaResult from "./CanvaResult";
import Turtle from "./Turtle";
import AgentPanel from "./agents/AgentPanel";
import InspirationBoard from "./inspiration/InspirationBoard";
import IntegrationHealth from "./settings/IntegrationHealth";
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
    "chat" | "projects" | "inspiration" | "agents"
  >("chat");
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [inspiration, setInspiration] = useState<InspirationItem[]>([]);
  const [sheetsSync, setSheetsSync] = useState<SheetSyncResult | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [sidebar, setSidebar] = useState(true);
  const [panel, setPanel] = useState<"settings" | "task" | "preview" | null>(
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
    const timer = setInterval(poll, 3000);
    const disconnected = () => setOffline(true);
    window.addEventListener("online", poll);
    window.addEventListener("offline", disconnected);
    document.addEventListener("visibilitychange", poll);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener("online", poll);
      window.removeEventListener("offline", disconnected);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [auth, refresh]);
  useEffect(() => {
    const textarea = input.current;
    if (!textarea) return;
    const resize = () => {
      textarea.style.height = "auto";
      const limit = Math.max(
        66,
        Math.min(
          190,
          (window.visualViewport?.height || window.innerHeight) * 0.28,
        ),
      );
      textarea.style.height = Math.min(textarea.scrollHeight, limit) + "px";
      textarea.style.overflowY =
        textarea.scrollHeight > limit ? "auto" : "hidden";
    };
    resize();
    let previousWidth = textarea.parentElement?.clientWidth;
    const observer = new ResizeObserver(() => {
      const width = textarea.parentElement?.clientWidth;
      if (width !== previousWidth) {
        previousWidth = width;
        resize();
      }
    });
    // Observe the parent width, not the textarea whose height we update.
    if (textarea.parentElement) observer.observe(textarea.parentElement);
    window.visualViewport?.addEventListener("resize", resize);
    return () => {
      observer.disconnect();
      window.visualViewport?.removeEventListener("resize", resize);
    };
  }, [text, auth, nav]);
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () =>
      document.documentElement.style.setProperty(
        "--app-height",
        (viewport?.height || window.innerHeight) + "px",
      );
    update();
    viewport?.addEventListener("resize", update);
    return () => viewport?.removeEventListener("resize", update);
  }, []);
  useEffect(() => {
    if (panel) dialog.current?.showModal();
    else dialog.current?.close();
  }, [panel]);
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
  async function branch(messageId: string, content: string) {
    if (!activeConv) return;
    setBusy(true);
    try {
      await createConversation(
        activeConv.title + " · 分支",
        activeConv.id,
        messageId,
        {
          text: content,
          uploads: [],
          references:
            activeConv.messages.find((m) => m.id === messageId)?.attachments ||
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
      api<{ items: InspirationItem[]; sheetsSync: SheetSyncResult | null }>("inspiration")
        .then((result) => { setInspiration(result.items); setSheetsSync(result.sheetsSync); })
        .catch(() => {});
  };
  const navigation = (
    <>
      <div className="brand">
        <span className="brand-mark">
          <Leaf size={20} />
        </span>
        <span>
          Hermes<small>龜龜創作助手</small>
        </span>
      </div>
      <button className="new-chat" onClick={fresh} disabled={busy}>
        <Plus size={19} />
        開啟新對話
        <Pencil size={16} />
      </button>
      <nav aria-label="主要導覽">
        <button
          aria-current={nav === "chat" ? "page" : undefined}
          onClick={() => navigate("chat")}
        >
          <MessageSquare size={19} />
          對話
        </button>
        <button
          aria-current={nav === "projects" ? "page" : undefined}
          onClick={() => navigate("projects")}
        >
          <Images size={19} />
          專案
        </button>
        <button
          aria-current={nav === "inspiration" ? "page" : undefined}
          onClick={() => navigate("inspiration")}
        >
          <Sparkles size={19} />
          靈感
        </button>
        <button
          aria-current={nav === "agents" ? "page" : undefined}
          onClick={() => navigate("agents")}
        >
          <Bot size={19} />
          Agent
        </button>
      </nav>
      <div className="side-section">
        <span>專案</span>
        <button
          aria-label="新增專案"
          onClick={() => {
            setPanel("settings");
            setSettingsTab("專案");
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
        個人工作區
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
      <div className="side-section">
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
        onClick={() => {
          setPanel("settings");
          setDrawer(false);
        }}
      >
        <Settings size={19} />
        設定與連線
        <span
          className={
            "status-dot " + (health?.credential === "valid" ? "good" : "")
          }
        />
      </button>
    </>
  );

  if (auth === "loading")
    return (
      <main className="workspace-loading">
        <p role="status">正在開啟工作區…</p>
      </main>
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
    >

      <a className="skip-link" href="#composer">
        跳至輸入區
      </a>
      {sidebar && <aside className="sidebar">{navigation}</aside>}
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
              ? "創作對話"
              : nav === "projects"
                ? "專案與素材"
                : nav === "inspiration"
                  ? "靈感"
                  : "Agent"}
            <span>
              {data.projects.find((p) => p.id === project)?.name ||
                "個人工作區"}
            </span>
          </div>
          <button
            className="connection-pill"
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
            <span>
              {offline
                ? "離線"
                : health
                  ? connectionLabels[health.status]
                  : "確認連線"}
            </span>
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
                (offline
                  ? "連線中斷，顯示上次已知資料。後端任務不會因關閉頁面而假裝停止。"
                  : notice)}
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
              <div className="conversation">
                {!activeConv?.messages.length ? (
                  <section className="welcome">
                    {prefs.turtle && (
                      <Turtle
                        offline={offline}
                        animation={prefs.animation}
                        size={prefs.turtleSize}
                        onClick={() => openTask()}
                      />
                    )}
                    <p className="eyebrow">歡迎使用 Hermes Creative Intelligence</p>
                    <h1>今天想做什麼？</h1>
                    <p>
                      直接告訴龜龜你想做什麼。
                      <br className="mobile-break" />
                      不必自己挑選工具。
                    </p>
                    <button
                      className="primary"
                      onClick={() => input.current?.focus()}
                    >
                      開始使用
                    </button>
                    <div className="starters">
                      {[
                        ["幫我找網宣靈感", "幫我找網宣靈感。"],
                        [
                          "幫我做淡江新生海報",
                          "幫我做一張給淡江大一新生看的社團茶會海報。",
                        ],
                        ["分析這張文宣", "請分析這張文宣。"],
                        [
                          "站在目標客群角度看看",
                          "站在目標客群角度看看，路人會不會滑掉。",
                        ],
                        [
                          "找 IG / Pinterest 參考",
                          "幫我找 IG 與 Pinterest 參考，不要假裝已搜尋完整平台。",
                        ],
                        ["做 Canva 草稿", "幫我做 Canva 草稿。"],
                      ].map(([label, prompt]) => (
                        <button
                          key={label}
                          onClick={() => {
                            setText(prompt);
                            input.current?.focus();
                          }}
                        >
                          <span>{label}</span>
                          <Plus size={16} />
                        </button>
                      ))}
                    </div>
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
                                    {asset.kind === "image" && (
                                      <img
                                        src={"/api/materials?id=" + asset.id}
                                        alt={asset.title}
                                      />
                                    )}
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
                          {["failed", "cancelled"].includes(
                            currentTask.state,
                          ) && (
                            <button
                              className="text-button"
                              onClick={() => {
                                const message = activeConv.messages.find(
                                  (m) =>
                                    m.taskId === currentTask.id &&
                                    m.role === "user",
                                );
                                if (message)
                                  void branch(message.id, message.content);
                              }}
                            >
                              建立重試分支（保留原紀錄）
                            </button>
                          )}
                        </article>
                      )}
                  </>
                )}
              </div>
            </div>
            <div className="composer-area">
              <span
                className="sr-only"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {currentTask
                  ? "Hermes 任務：" + taskLabels[currentTask.state]
                  : ""}
              </span>
              {jump && (
                <button
                  className="jump-button"
                  onClick={() => {
                    nearBottom.current = true;
                    setJump(false);
                    scroll.current?.scrollTo({
                      top: scroll.current.scrollHeight,
                      behavior: "auto",
                    });
                  }}
                >
                  <ChevronDown size={16} />
                  回到最新訊息
                </button>
              )}
              <div className="composer-row">
                {prefs.turtle && !!activeConv?.messages.length && (
                  <Turtle
                    task={currentTask}
                    offline={offline}
                    animation={prefs.animation}
                    size={Math.min(prefs.turtleSize, 72)}
                    compact
                    onClick={() => openTask(currentTask)}
                  />
                )}
                <form
                  id="composer"
                  className="composer"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send();
                  }}
                >
                  {(uploads.length > 0 || references.length > 0) && (
                    <div className="upload-list">
                      {uploads.map((u) => (
                        <div className="upload-chip" key={u.key}>
                          {u.material?.kind === "image" && (
                            <img
                              src={"/api/materials?id=" + u.material.id}
                              alt="附件預覽"
                            />
                          )}
                          <span>
                            {u.file.name}
                            <small>
                              {u.error ||
                                (!u.material
                                  ? "上傳 " + u.progress + "%"
                                  : "已保存")}
                            </small>
                          </span>
                          {u.error && (
                            <button
                              type="button"
                              aria-label="重試上傳"
                              disabled={busy}
                              onClick={() => uploadFile(u.file, u.key)}
                            >
                              <RefreshCw size={16} />
                            </button>
                          )}
                          <button
                            type="button"
                            aria-label="移除附件"
                            disabled={busy}
                            onClick={() => {
                              pendingXHR.current.get(u.key)?.abort();
                              setUploads((old) =>
                                old.filter((x) => x.key !== u.key),
                              );
                            }}
                          >
                            <X size={15} />
                          </button>
                        </div>
                      ))}
                      {references.map((id) => (
                        <div className="upload-chip" key={id}>
                          <LinkIcon size={16} />
                          <span>
                            {data.materials.find((m) => m.id === id)?.title}
                          </span>
                          <button
                            type="button"
                            aria-label="移除參考"
                            disabled={busy}
                            onClick={() =>
                              setReferences((old) =>
                                old.filter((x) => x !== id),
                              )
                            }
                          >
                            <X size={15} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <textarea
                    ref={input}
                    value={text}
                    rows={2}
                    maxLength={20_000}
                    placeholder="說說你的想法，或加入參考素材…"
                    aria-label="訊息"
                    aria-describedby="composer-hint"
                    readOnly={busy}
                    onChange={(e) => setText(e.target.value)}
                    onCompositionStart={() => {
                      composing.current = true;
                    }}
                    onCompositionEnd={() => {
                      composing.current = false;
                    }}
                    onKeyDown={(e) => {
                      if (
                        e.key === "Enter" &&
                        !e.shiftKey &&
                        !e.nativeEvent.isComposing &&
                        !composing.current &&
                        e.keyCode !== 229
                      ) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                  />
                  <div className="composer-tools">
                    <input
                      ref={uploadInput}
                      className="sr-only"
                      tabIndex={-1}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,text/plain,application/pdf"
                      multiple
                      disabled={busy}
                      onChange={(e) => {
                        const files = Array.from(e.target.files || []);
                        e.target.value = "";
                        if (
                          files.length + uploads.length + references.length >
                          4
                        ) {
                          setError("每則訊息最多四個附件。");
                          return;
                        }
                        files.forEach((file) => uploadFile(file));
                      }}
                    />
                    <button
                      className="icon-button"
                      type="button"
                      aria-label="上傳圖片或文字檔"
                      disabled={busy}
                      title="PNG、JPG、WebP、TXT 或 PDF；每個檔案最多 8 MB，每則訊息最多四個附件"
                      onClick={() => uploadInput.current?.click()}
                    >
                      <Plus size={23} />
                    </button>
                    <button
                      className="composer-label"
                      type="button"
                      disabled={busy}
                      onClick={() => setNav("projects")}
                    >
                      <ImagePlus size={17} />
                      加入素材
                    </button>
                    <span className="composer-mode">Hermes · 草稿工作區</span>
                    {pending ? (
                      <button
                        className="send-button"
                        type="button"
                        aria-label="停止任務"
                        onClick={() => stopTask(pending)}
                      >
                        <Square size={18} />
                      </button>
                    ) : (
                      <button
                        className="send-button"
                        type="submit"
                        aria-label="送出訊息"
                        disabled={
                          busy ||
                          blocked ||
                          !text.trim() ||
                          uploads.some((u) => !u.material)
                        }
                      >
                        <ArrowUp size={21} />
                      </button>
                    )}
                  </div>
                </form>
              </div>
              <p className="composer-footnote" id="composer-hint">
                {text || uploads.length || references.length
                  ? "草稿暫存於此分頁，重新整理將清除。"
                  : "請核對重要資訊與素材權利。"}
                <span>Enter 送出 · Shift + Enter 換行</span>
              </p>
            </div>
          </>
        ) : nav === "projects" ? (
          <section className="secondary-page">
            <p className="eyebrow">收好靈感，接著創作</p>
            <h1>素材與靈感</h1>
            <p className="muted">
              保存來源與你的素材，不將參考作品視為可直接發佈的素材。
            </p>
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
                      {m.kind === "image" ? (
                        <img src={"/api/materials?id=" + m.id} alt={m.title} />
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
          <InspirationBoard
            items={inspiration}
            syncStatus={sheetsSync}
            onSync={async () => {
              const result = await api<{ sheetsSync: SheetSyncResult }>("inspiration", "POST", { action: "sync_sheets" });
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
        ) : (
          <section className="secondary-page">
            <AgentPanel agents={agents} brain={[]} />
            <p className="eyebrow">每一步都有紀錄</p>
            <h1>任務</h1>
            <p className="muted">這裡只呈現後端儲存及 Hermes 回報的狀態。</p>
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
                  {w.design && <CanvaResult design={w.design} />}
                </section>
              ))}
            {!tasks.length && !workflows.length && (
              <div className="empty-state">
                <ListTodo size={30} />
                <h2>目前沒有任務</h2>
                <p>送出第一則訊息後，便能在這裡查回執行結果。</p>
              </div>
            )}
            {tasks.map((t) => (
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
      <dialog
        ref={dialog}
        className="detail-dialog"
        aria-labelledby="detail-panel-title"
        onCancel={() => setPanel(null)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setPanel(null);
        }}
      >
        <div className="panel-content">
          <header className="panel-header">
            <h2 id="detail-panel-title">
              {panel === "settings"
                ? "工作區設定"
                : panel === "preview"
                  ? "素材預覽"
                  : "任務詳情"}
            </h2>
            <button
              className="icon-button"
              aria-label="關閉面板"
              onClick={() => setPanel(null)}
            >
              <X size={21} />
            </button>
          </header>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {panel === "settings" ? (
            <>
              <div
                className="setting-tabs"
                role="tablist"
                aria-label="設定分類"
                onKeyDown={(event) => {
                  if (
                    !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                      event.key,
                    )
                  )
                    return;
                  const tabs = Array.from(
                    event.currentTarget.querySelectorAll<HTMLButtonElement>(
                      '[role="tab"]',
                    ),
                  );
                  const index = tabs.indexOf(
                    document.activeElement as HTMLButtonElement,
                  );
                  const next =
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? tabs.length - 1
                        : (index +
                            (event.key === "ArrowRight" ? 1 : -1) +
                            tabs.length) %
                          tabs.length;
                  event.preventDefault();
                  tabs[next]?.focus();
                  tabs[next]?.click();
                }}
              >
                {["外觀", "連線", "記憶", "使用量", "專案"].map((tab) => (
                  <button
                    key={tab}
                    role="tab"
                    id={"setting-tab-" + tab}
                    aria-controls="setting-panel"
                    aria-selected={settingsTab === tab}
                    tabIndex={settingsTab === tab ? 0 : -1}
                    onClick={() => setSettingsTab(tab)}
                  >
                    {tab}
                  </button>
                ))}
              </div>
              <div
                role="tabpanel"
                id="setting-panel"
                aria-labelledby={"setting-tab-" + settingsTab}
                tabIndex={0}
              >
                {settingsTab === "外觀" ? (
                  <div className="settings-stack">
                    <p className="muted">
                      固定明亮介面。外觀偏好只儲存在此瀏覽器。
                    </p>
                    <label>
                      文字大小
                      <select
                        value={prefs.font}
                        onChange={(e) =>
                          setPrefs({ ...prefs, font: Number(e.target.value) })
                        }
                      >
                        {[14, 16, 18, 20].map((n) => (
                          <option key={n} value={n}>
                            {n} px
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      閱讀寬度
                      <select
                        value={prefs.width}
                        onChange={(e) =>
                          setPrefs({ ...prefs, width: Number(e.target.value) })
                        }
                      >
                        {[680, 780, 920].map((n) => (
                          <option key={n} value={n}>
                            {n} px
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="check-row">
                      <input
                        type="checkbox"
                        checked={prefs.compact}
                        onChange={(e) =>
                          setPrefs({ ...prefs, compact: e.target.checked })
                        }
                      />
                      緊湊訊息間距
                    </label>
                    <label className="check-row">
                      <input
                        type="checkbox"
                        checked={prefs.turtle}
                        onChange={(e) =>
                          setPrefs({ ...prefs, turtle: e.target.checked })
                        }
                      />
                      顯示龜龜
                    </label>
                    <label className="check-row">
                      <input
                        type="checkbox"
                        checked={prefs.animation}
                        onChange={(e) =>
                          setPrefs({ ...prefs, animation: e.target.checked })
                        }
                      />
                      輕柔動畫（尊重系統減少動畫設定）
                    </label>
                    <label>
                      龜龜大小
                      <select
                        value={prefs.turtleSize}
                        onChange={(e) =>
                          setPrefs({
                            ...prefs,
                            turtleSize: Number(e.target.value),
                          })
                        }
                      >
                        {[72, 100, 128].map((n) => (
                          <option key={n} value={n}>
                            {n} px
                          </option>
                        ))}
                      </select>
                    </label>
                    <button onClick={() => setPrefs(DEFAULT_PREFS)}>
                      重設外觀
                    </button>
                  </div>
                ) : settingsTab === "連線" ? (
                  <div className="settings-stack">
                    <h3>Hermes</h3>
                    <p>{health?.message || "尚未取得狀態。"}</p>
                    <dl className="facts">
                      <dt>服務可達</dt>
                      <dd>
                        {health?.reachable === null || !health
                          ? "未知"
                          : health.reachable
                            ? "是"
                            : "否"}
                      </dd>
                      <dt>憑證驗證</dt>
                      <dd>
                        {health?.credential === "valid"
                          ? "有效"
                          : health?.credential === "invalid"
                            ? "無效"
                            : "尚未確認"}
                      </dd>
                      <dt>Agent 執行</dt>
                      <dd>
                        {health?.agent === "verified"
                          ? "已有成功任務"
                          : "未驗證"}
                      </dd>
                      <dt>最後連線檢查</dt>
                      <dd>{health ? time(health.checkedAt) : "未知"}</dd>
                    </dl>
                    <button
                      onClick={async () => {
                        setBusy(true);
                        try {
                          setHealth(await api<Health>("health", "POST", {}));
                          const result = await api<{
                            integrations: Integration[];
                          }>("integrations");
                          setIntegrations(result.integrations);
                        } catch (e) {
                          setError((e as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                      disabled={busy}
                    >
                      <RefreshCw size={16} />
                      {busy ? "驗證中…" : "重新驗證連線"}
                    </button>
                    <p className="muted">
                      網址、金鑰只在後端設定。此處不收集或顯示金鑰。
                    </p>
                    <IntegrationHealth items={integrations} />
                    <h3>Canva Connect 授權</h3>
                    <p>
                      {canvaConfigured
                        ? "後端已設定 OAuth；請前往 Canva 授權並確認所需權限。此授權只用於 Canva。"
                        : "後端尚未設定 Canva OAuth。也可沿用 Hermes 已有的 Canva 設計 MCP。"}
                    </p>
                    <button
                      disabled={!canvaConfigured}
                      onClick={async () => {
                        try {
                          const result = await api<{ url: string }>(
                            "canva",
                            "POST",
                            { action: "authorize" },
                          );
                          window.location.assign(result.url);
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    >
                      前往 Canva 授權 <ExternalLink size={16} />
                    </button>
                    <label>
                      尋找工具與技能
                      <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="搜尋名稱或用途"
                      />
                    </label>
                    {integrations
                      .filter((i) =>
                        (i.name + " " + i.detail + " " + i.tools.join(" "))
                          .toLowerCase()
                          .includes(search.toLowerCase()),
                      )
                      .map((i) => (
                        <details className="integration" key={i.id}>
                          <summary>
                            <strong>{i.name}</strong>
                            <span className="badge">
                              {connectionLabels[i.state]}
                            </span>
                          </summary>
                          <p>{i.detail}</p>
                          <p>{i.evidence || "尚無執行驗證證據。"}</p>
                          <small>
                            最後驗證：
                            {i.verifiedAt ? time(i.verifiedAt) : "未驗證"}
                          </small>
                          <ul>
                            {i.requirements.map((value) => (
                              <li key={value}>{value}</li>
                            ))}
                          </ul>
                          {!!i.tools.length && (
                            <p>已宣告工具：{i.tools.join("、")}</p>
                          )}
                        </details>
                      ))}
                    {(health?.skills || [])
                      .filter((s) =>
                        (s.name + s.description)
                          .toLowerCase()
                          .includes(search.toLowerCase()),
                      )
                      .map((s) => (
                        <details key={s.name}>
                          <summary>{s.name}</summary>
                          <p>{s.description}</p>
                        </details>
                      ))}
                  </div>
                ) : settingsTab === "記憶" ? (
                  <div className="settings-stack">
                    <h3>記憶與會話</h3>
                    <p>{data.memory.scope}</p>
                    <p className="muted">
                      未取得可驗證的記憶管理介面，不提供假同步、假刪除或本地記憶清單。Console
                      對話歷史與 Hermes 長期記憶是不同資料。
                    </p>
                    <button
                      disabled={!activeConv?.hermesSessionId}
                      onClick={async () => {
                        try {
                          const result = await api<{
                            remoteHistory: typeof remoteHistory;
                          }>("conversations?id=" + activeId);
                          setRemoteHistory(result.remoteHistory);
                          if (!result.remoteHistory)
                            setNotice("部署版本不支援會話歷史查詢。");
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    >
                      讀取目前 Hermes 會話歷史
                    </button>
                    {remoteHistory?.map((m, i) => (
                      <details key={i}>
                        <summary>
                          {m.role}
                          {m.name ? " · " + m.name : ""}
                        </summary>
                        <MessageBody text={m.content} />
                      </details>
                    ))}
                    {legacy && (
                      <button onClick={importLegacy}>匯入舊版瀏覽器對話</button>
                    )}
                  </div>
                ) : settingsTab === "使用量" ? (
                  <div className="settings-stack">
                    <p>
                      僅顯示 Hermes
                      回傳的統計。未知費用不是零，也不推測外部工具費用。
                    </p>
                    {tasks.map((t) => (
                      <details key={t.id}>
                        <summary>{t.input.slice(0, 40)}</summary>
                        <Usage task={t} />
                      </details>
                    ))}
                    {!tasks.length && (
                      <p className="muted">尚無任務使用量資料。</p>
                    )}
                  </div>
                ) : (
                  <div className="settings-stack">
                    <p>
                      目前有 {data.projects.length}{" "}
                      個自訂專案；不包含預設個人工作區。
                    </p>
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        try {
                          await api("workspace", "POST", { name: newProject });
                          setNewProject("");
                          await loadWorkspace();
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    >
                      <label>
                        新增專案
                        <input
                          required
                          maxLength={80}
                          value={newProject}
                          onChange={(e) => setNewProject(e.target.value)}
                        />
                      </label>
                      <button className="primary">
                        <Plus size={16} />
                        建立專案
                      </button>
                    </form>
                  </div>
                )}
              </div>
              <footer className="settings-footer">
                <p className="muted">單一工作區 · 秘密只存在後端</p>
              </footer>
            </>
          ) : panel === "preview" && preview ? (
            <div className="settings-stack">
              <h3>{preview.title}</h3>
              {preview.kind === "image" && (
                <img
                  className="full-preview"
                  src={"/api/materials?id=" + preview.id}
                  alt={preview.title}
                />
              )}
              <p>
                {preview.rights === "reference_only"
                  ? "參考用途；使用權利未確認。"
                  : "使用者提供素材，發佈前請確認使用權利。"}
              </p>
              <p>{preview.notes}</p>
              {preview.url ? (
                <a
                  className="button-link"
                  href={preview.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  開啟原始來源 <ExternalLink size={16} />
                </a>
              ) : (
                <a
                  className="button-link"
                  href={"/api/materials?id=" + preview.id}
                  download={preview.title}
                >
                  下載素材 <Download size={16} />
                </a>
              )}
              <small>保存時間：{time(preview.createdAt)}</small>
            </div>
          ) : chosenTask ? (
            <div className="settings-stack">
              <span className={"badge " + chosenTask.state}>
                {taskLabels[chosenTask.state]}
              </span>
              <h3>{chosenTask.input}</h3>
              <small>
                任務：{chosenTask.id}
                <br />
                Hermes 任務：{chosenTask.remoteId || "串流模式／尚未取得"}
              </small>
              {chosenTask.error && <p className="error">{chosenTask.error}</p>}
              {chosenTask.observationError && (
                <p className="error">{chosenTask.observationError}</p>
              )}
              {isActive(chosenTask) && (
                <button onClick={() => stopTask(chosenTask)}>
                  <Square size={16} />
                  要求停止
                  {!chosenTask.stopSupported ? "（無法確認上游停止）" : ""}
                </button>
              )}
              {!!chosenTask.output && (
                <>
                  <MessageBody text={chosenTask.output} />
                  <button onClick={() => download(chosenTask)}>
                    <Download size={16} />
                    下載文字成果
                  </button>
                  <button
                    onClick={() => {
                      const c = data.conversations.find(
                        (c) => c.id === chosenTask.conversationId,
                      );
                      if (c) {
                        selectConversation(c);
                        setPanel(null);
                        input.current?.focus();
                      }
                    }}
                  >
                    回到對話繼續修改
                  </button>
                </>
              )}
              <Usage task={chosenTask} />
              <h3>真實事件紀錄</h3>
              {chosenTask.events.map((e) => (
                <details className="event" key={e.id}>
                  <summary>
                    <span>
                      {e.toolName || "任務"} · {e.summary}
                    </span>
                  </summary>
                  <small>
                    {time(e.startedAt)} · {e.status}
                  </small>
                  {e.result !== null && (
                    <MessageBody
                      text={
                        typeof e.result === "string"
                          ? e.result
                          : JSON.stringify(e.result, null, 2)
                      }
                    />
                  )}
                  {e.sources.map((source) => (
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
              ))}
            </div>
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
function Usage({ task }: { task: Task }) {
  const value = (input: number | null) =>
    input === null ? "未知" : input.toLocaleString("zh-TW");
  return (
    <dl className="facts">
      <dt>實際模型</dt>
      <dd>{task.usage.model || "未知"}</dd>
      <dt>輸入 tokens</dt>
      <dd>{value(task.usage.inputTokens)}</dd>
      <dt>輸出 tokens</dt>
      <dd>{value(task.usage.outputTokens)}</dd>
      <dt>總 tokens</dt>
      <dd>{value(task.usage.totalTokens)}</dd>
      <dt>任務耗時</dt>
      <dd>
        {task.usage.durationMs === null
          ? "尚未結束"
          : (task.usage.durationMs / 1000).toFixed(1) + " 秒"}
      </dd>
      <dt>模型供應商費用</dt>
      <dd>{value(task.usage.providerCost)}</dd>
      <dt>外部工具費用</dt>
      <dd>{value(task.usage.toolCost)}</dd>
    </dl>
  );
}
