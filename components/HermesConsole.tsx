"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Check,
  ChevronDown,
  Code2,
  Copy,
  Folder,
  ImagePlus,
  Images,
  Leaf,
  ListTodo,
  Sparkles,
  Bot,
  MessageSquare,
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
import HelpPage from "./help/HelpPage";
import KnowledgeArchive from "./knowledge/KnowledgeArchive";
import ProjectWorkbench from "./ProjectWorkbench";
import LearningMap from "./LearningMap";
import IntegrationHealth from "./settings/IntegrationHealth";
import CapabilityCertification from "./settings/CapabilityCertification";
import AccountSettings from "./settings/AccountSettings";
import AppearanceSettings, {
  DEFAULT_APPEARANCE,
  type AppearancePreferences,
} from "./settings/AppearanceSettings";
import ConnectionSettings from "./settings/ConnectionSettings";
import SettingsTabs, { type SettingsTab } from "./settings/SettingsTabs";
import SharedMemory from "./settings/SharedMemory";
import AttachmentCover from "./visual/AttachmentCover";
import TopBar from "./visual/TopBar";
import type { ConsoleNav } from "./visual/TopBar";
import HermesCore from "./visual/HermesCore";
import QuickActions from "./visual/QuickActions";
import AgentActivity from "./visual/AgentActivity";
import AppDock from "./visual/AppDock";
import SpatialPanel from "./visual/SpatialPanel";
import { useSpatialMode } from "./visual/useSpatialMode";
import ArtifactDeck from "./visual/ArtifactDeck";
import ComposerMenu from "./visual/ComposerMenu";
import ComposerTaskStatus, {
  OFFLINE_NOTICE,
  OFFLINE_PILL_LABEL,
  composerTaskPillAction,
  shortTaskError,
} from "./visual/ComposerTaskStatus";
import { taskProgressLabel } from "@/lib/client/activity";
import {
  continueArtifactPrompt,
  continueDirectionPrompt,
} from "@/lib/client/continue-prompts";
import ContextTray from "./visual/ContextTray";
import ProjectShelf from "./visual/ProjectShelf";
import VisualMessage from "./visual/VisualMessage";
import TaskEventSummary from "./visual/TaskEventSummary";
import TaskUsageSummary from "./visual/TaskUsageSummary";
import TaskRequestSummary from "./visual/TaskRequestSummary";
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
import { workspacePollDelay } from "@/lib/client/poll";
import { applyAppViewport } from "@/lib/client/viewport";
import {
  liveTaskCovered,
  visibleChatMessages,
} from "@/lib/client/chat-thread";

type Project = { id: string; name: string };
type RemoteHistory = Array<{ role: string; content: string; name?: string }>;
type Workspace = {
  conversations: Conversation[];
  projects: Project[];
  materials: Material[];
  imageInput: boolean;
  memory: { status: string; scope: string; synced: boolean };
};
type Preferences = AppearancePreferences;
const DEFAULT_PREFS = DEFAULT_APPEARANCE;
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
const connectionLabels: Record<string, string> = {
  unconfigured: "未設定",
  awaiting_authorization: "待授權",
  verifying: "驗證中",
  available: "可用",
  partial: "部分可用",
  failed: "失敗",
};
function isLocalIndexTask(
  task?: Task | null,
  messages?: Conversation["messages"],
) {
  return !!task && !!messages?.some(
    (message) =>
      message.taskId === task.id &&
      message.role === "assistant" &&
      message.provenance === "workspace",
  );
}
const isActive = (task: Task) =>
  ["queued", "running", "waiting_user", "waiting_authorization", "stopping"].includes(task.state);
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
  const [nav, setNav] = useState<ConsoleNav>("chat");
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [inspiration, setInspiration] = useState<InspirationItem[]>([]);
  const [sheetsSync, setSheetsSync] = useState<SheetSyncResult | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [sidebar, setSidebar] = useState(false);
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [panel, setPanel] = useState<"settings" | "task" | "preview" | "spatial" | null>(
    null,
  );
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("外觀");
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
  const projectUpload = useRef<HTMLInputElement>(null);
  const secondaryPage = useRef<HTMLElement>(null);
  const secondaryScroll = useRef(0);
  const nearBottom = useRef(true);
  const composing = useRef(false);
  const requestKey = useRef<{ payload: string; key: string } | null>(null);
  const pendingXHR = useRef(new Map<string, XMLHttpRequest>());
  const tasksRef = useRef(tasks);
  const pokePoll = useRef<() => void>(() => {});
  const hadActiveTask = useRef(false);
  const sending = useRef(false);
  tasksRef.current = tasks;
  const activeConv = data.conversations.find((c) => c.id === activeId);
  const currentTasks = tasks.filter((t) => t.conversationId === activeId);
  const currentTask =
    currentTasks.find(isActive) ||
    currentTasks.find((t) => t.state === "uncertain") ||
    currentTasks[0];
  const pending = currentTasks.find(isActive);
  const uncertain = currentTasks.find((t) => t.state === "uncertain");
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
    tasksRef.current = taskResult.tasks;
  }, []);
  const chooseVisualDirection = useCallback(
    async (workflowId: string, index: number) => {
      try {
        await api("workflows", "PATCH", { id: workflowId, selected: index });
        await refresh();
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [refresh],
  );
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
      loading = false,
      timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (ms: number) => {
      if (stopped) return;
      clearTimeout(timer);
      timer = setTimeout(() => void tick(), ms);
    };
    const tick = async () => {
      if (stopped) return;
      clearTimeout(timer);
      if (document.hidden) {
        schedule(workspacePollDelay(true, tasksRef.current.some(isActive)));
        return;
      }
      if (loading) return;
      loading = true;
      try {
        await refresh();
      } catch {
        if (!stopped) setOffline(true);
      } finally {
        loading = false;
      }
      if (stopped) return;
      schedule(
        workspacePollDelay(
          document.hidden,
          tasksRef.current.some(isActive),
        ),
      );
    };
    const onOnline = () => void tick();
    const disconnected = () => setOffline(true);
    const onVisible = () => {
      if (document.hidden)
        schedule(workspacePollDelay(true, tasksRef.current.some(isActive)));
      else void tick();
    };
    pokePoll.current = () => void tick();
    void tick();
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", disconnected);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      pokePoll.current = () => {};
      clearTimeout(timer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", disconnected);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [auth, refresh]);
  useEffect(() => {
    if (auth !== "ready") return;
    const active = tasks.some(isActive);
    if (active && !hadActiveTask.current) pokePoll.current();
    hadActiveTask.current = active;
  }, [auth, tasks]);
  useEffect(() => {
    const textarea = input.current;
    if (!textarea) return;
    const resize = () => {
      textarea.style.height = "auto";
      const limit = Math.max(
        66,
        Math.min(
          190,
          Math.floor(
            (window.visualViewport?.height || window.innerHeight) * 0.28,
          ),
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
    window.addEventListener("resize", resize);
    return () => {
      observer.disconnect();
      window.visualViewport?.removeEventListener("resize", resize);
      window.removeEventListener("resize", resize);
    };
  }, [text, auth, nav]);
  useEffect(() => {
    const viewport = window.visualViewport;
    let baseline = {
      width: viewport?.width || window.innerWidth,
      height: viewport?.height || window.innerHeight,
    };
    let previousWidth = baseline.width;
    let frame = 0;
    const update = () => {
      const current = {
        width: viewport?.width || window.innerWidth,
        height: viewport?.height || window.innerHeight,
      };
      const composerFocused = document.activeElement === input.current;
      const widthChanged = Math.abs(current.width - previousWidth) > 16;
      if (
        !composerFocused ||
        widthChanged ||
        current.height > baseline.height
      ) {
        baseline = current;
      }
      previousWidth = current.width;
      applyAppViewport(composerFocused, widthChanged);
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
      delete document.documentElement.dataset.composerKeyboard;
    };
  }, []);
  useEffect(() => {
    if (panel) dialog.current?.showModal();
    else {
      dialog.current?.close();
      // Chromium showModal() writes inline overflow; leaving it as auto
      // would override html/body { overflow: hidden } and steal page scroll.
      document.documentElement.style.removeProperty("overflow");
      document.body.style.removeProperty("overflow");
    }
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
    if (was === "preview" && !panel) {
      const top = secondaryScroll.current;
      const frame = requestAnimationFrame(() => {
        if (secondaryPage.current) secondaryPage.current.scrollTop = top;
      });
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
    setNotice("");
    writePreference("hermes.active.v2", conv.id);
  }
  function fresh() {
    if (busy) return;
    setRemoteHistory(null);
    setActiveId(null);
    setNav("chat");
    setDrawer(false);
    setError("");
    setNotice("");
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
    if (
      sending.current ||
      busy ||
      blocked ||
      !text.trim() ||
      uploads.some((u) => !u.material)
    )
      return;
    sending.current = true;
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
      sending.current = false;
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
      setNotice("已確認這筆結果，可以再送出。遠端是否已停，仍無法確認。");
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
      setError("找不到這則對話，無法另開重試。");
      return;
    }
    const message = conv.messages.find(
      (m) => m.taskId === task.id && m.role === "user",
    );
    if (!message) {
      setError("找不到觸發這則任務的訊息，無法另開重試。");
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
        source.title + " · 重試",
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
      setNotice("已另開對話，原本那則還在。改完再送出。");
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
  function closePanel() {
    setPanel(null);
  }
  function openPreview(material: Material) {
    if (secondaryPage.current) {
      secondaryScroll.current = secondaryPage.current.scrollTop;
    }
    setPreview(material);
    setPanel("preview");
  }
  function rememberPageScroll(el: HTMLElement) {
    if (dialog.current?.open) return;
    secondaryScroll.current = el.scrollTop;
  }
  function onComposerTaskPillClick(task: Task) {
    // Offline: refresh only — never open-resend or acknowledge.
    if (composerTaskPillAction(offline) === "refresh") {
      void refresh().catch(() => setOffline(true));
      return;
    }
    openTask(task);
  }
  function uploadFile(file: File, key = crypto.randomUUID(), attach = true) {
    if (file.size > 8_000_000) {
      setError("每個檔案上限 8 MB。");
      return;
    }
    const record: Upload = { key, file, progress: 0, error: null };
    if (attach) {
      setUploads((old) => [...old.filter((u) => u.key !== key), record]);
    } else {
      setNotice("正在上傳…");
    }
    const xhr = new XMLHttpRequest();
    pendingXHR.current.set(key, xhr);
    xhr.open("POST", "/api/materials?projectId=" + encodeURIComponent(project));
    xhr.setRequestHeader("Content-Type", file.type || "text/plain");
    xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || !attach) return;
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
      if (attach) {
        setUploads((old) =>
          old.map((u) => (u.key === key ? { ...u, error: message } : u)),
        );
      } else {
        setError(message);
      }
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
        if (attach) {
          setUploads((old) =>
            old.map((u) =>
              u.key === key
                ? { ...u, progress: 100, material: result.material }
                : u,
            ),
          );
        } else {
          setNotice("素材已保存");
        }
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
    setNotice("");
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
      data-sheet-open={!!panel || drawer}
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
        <TopBar
          nav={nav}
          mobile={spatial.mobile}
          projectName={
            data.projects.find((p) => p.id === project)?.name || "個人工作區"
          }
          sidebar={sidebar}
          offline={offline}
          health={health}
          connectionLabel={
            health ? connectionLabels[health.status] : "確認連線"
          }
          onToggleSidebar={() => setSidebar(!sidebar)}
          onOpenDrawer={() => setDrawer(true)}
          onOpenTasks={() => navigate("tasks")}
          onOpenConnections={() => {
            setSettingsTab("連線");
            setPanel("settings");
          }}
          onOpenAppearance={() => {
            setSettingsTab("外觀");
            setPanel("settings");
          }}
          onNewChat={fresh}
        />
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
                        這是另開的對話，原本那則還在。
                      </p>
                    )}
                    {currentTask && isActive(currentTask) && (
                      <AgentActivity
                        task={currentTask}
                        onInspect={() => openTask(currentTask)}
                      />
                    )}
                    {visibleChatMessages(activeConv.messages).map((message) => (
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
                          {message.provenance === "workspace" && (
                            <span>工作區資料</span>
                          )}
                        </div>
                        <div className="message-content">
                          <MessageBody
                            text={message.content}
                            workflows={workflows}
                            canvaReady={canvaConfigured}
                            onChooseDirection={chooseVisualDirection}
                          />
                          {message.role === "assistant" &&
                            message.taskId &&
                            message.provenance !== "workspace" && (
                            <VisualMessage
                              task={tasks.find((t) => t.id === message.taskId)}
                              onInspect={() =>
                                openTask(
                                  tasks.find((t) => t.id === message.taskId),
                                )
                              }
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
                                    onClick={() => openPreview(asset)}
                                  >
                                    <AttachmentCover material={asset} />
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
                              aria-label="編輯並另開對話"
                              onClick={() =>
                                branch(message.id, message.content)
                              }
                              disabled={busy}
                            >
                              <Pencil size={15} />
                            </button>
                          )}
                        </div>
                      </article>
                    ))}
                    {currentTask &&
                      !liveTaskCovered(
                        visibleChatMessages(activeConv.messages),
                        currentTask,
                      ) && (
                        <article className="message assistant">
                          <div className="message-byline">
                            Hermes
                            <span className="task-status">
                              {taskProgressLabel(currentTask)}
                            </span>
                          </div>
                          {currentTask.output && (
                            <MessageBody
                              text={currentTask.output}
                              workflows={workflows}
                              canvaReady={canvaConfigured}
                              onChooseDirection={chooseVisualDirection}
                            />
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
                            {taskProgressLabel(currentTask)}
                            <ChevronDown size={16} />
                          </button>
                          {["failed", "cancelled", "uncertain"].includes(
                            currentTask.state,
                          ) && (
                            <button
                              className="text-button"
                              onClick={() => retryBranchFromTask(currentTask)}
                            >
                              另開對話重試
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
            <div className="composer-area">
              <span
                className="sr-only"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {currentTask
                  ? "目前進度：" + taskProgressLabel(currentTask)
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
              {currentTask &&
                !isLocalIndexTask(currentTask, activeConv?.messages) && (
                <ComposerTaskStatus
                  task={currentTask}
                  offline={offline}
                  onClick={() => onComposerTaskPillClick(currentTask)}
                />
              )}
              {uncertain && (
                <div className="composer-uncertain-hint" role="status">
                  <p>
                    結果待確認，此對話暫時不能再送出。可確認後再送，或另開對話重試；遠端是否已停，仍無法確認。
                  </p>
                  <div className="composer-uncertain-actions">
                    <button
                      type="button"
                      onClick={() => void acknowledgeTask(uncertain)}
                    >
                      <RefreshCw size={16} aria-hidden="true" />
                      確認並可重試
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => retryBranchFromTask(uncertain)}
                      disabled={busy}
                    >
                      另開對話重試
                    </button>
                  </div>
                </div>
              )}
              <div className="composer-row">
                {prefs.turtle && !!activeConv?.messages.length && (
                  <Turtle
                    task={currentTask}
                    offline={offline}
                    animation={prefs.animation}
                    size={Math.min(prefs.turtleSize, 72)}
                    compact
                    onClick={() =>
                      currentTask &&
                      !isLocalIndexTask(currentTask, activeConv?.messages)
                        ? onComposerTaskPillClick(currentTask)
                        : undefined
                    }
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
                  <ContextTray
                    uploads={uploads}
                    references={references}
                    materials={data.materials}
                    disabled={busy}
                    onPreview={openPreview}
                    onRetry={(upload) => uploadFile(upload.file, upload.key)}
                    onRemoveUpload={(key) => {
                      pendingXHR.current.get(key)?.abort();
                      setUploads((old) => old.filter((u) => u.key !== key));
                    }}
                    onRemoveReference={(id) =>
                      setReferences((old) =>
                        old.filter((value) => value !== id),
                      )
                    }
                  />
                  <textarea
                    ref={input}
                    value={text}
                    rows={1}
                    maxLength={20_000}
                    placeholder="想做什麼？"
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
                      aria-label="選擇附件檔案"
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
                    <ComposerMenu
                      disabled={busy}
                      onUpload={(kind) => {
                        if (uploadInput.current) {
                          uploadInput.current.accept =
                            kind === "image"
                              ? "image/png,image/jpeg,image/webp"
                              : "text/plain,application/pdf";
                          uploadInput.current.click();
                        }
                      }}
                      onNavigate={(kind) => {
                        if (kind === "canva") {
                          setText(
                            "請查回我已有的 Canva 設計，選擇要接續修改的作品。",
                          );
                          input.current?.focus();
                        } else {
                          setNav("projects");
                          setReferenceOpen(kind === "reference");
                        }
                      }}
                    />
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
              <p className="sr-only" id="composer-hint">
                {text || uploads.length || references.length
                  ? "草稿暫存於此分頁，重新整理將清除。"
                  : "請核對重要資訊與素材權利。"}
                <span>Enter 送出 · Shift + Enter 換行</span>
              </p>
            </div>
          </>
        ) : nav === "projects" ? (
          <section
            className="secondary-page"
            ref={secondaryPage}
            onScroll={(e) => rememberPageScroll(e.currentTarget)}
          >
            <div className="page-heading-row">
              <h1>專案</h1>
              <div className="page-heading-actions">
                <input
                  ref={projectUpload}
                  className="sr-only"
                  tabIndex={-1}
                  type="file"
                  aria-label="上傳專案素材"
                  accept="image/png,image/jpeg,image/webp,text/plain,application/pdf"
                  multiple
                  disabled={busy}
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    e.target.value = "";
                    files.forEach((file) =>
                      uploadFile(file, crypto.randomUUID(), false),
                    );
                  }}
                />
                <button
                  type="button"
                  className="text-button"
                  aria-label="上傳素材"
                  disabled={busy}
                  onClick={() => projectUpload.current?.click()}
                >
                  <ImagePlus size={18} />
                  上傳
                </button>
              </div>
            </div>
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
            <ArtifactDeck
              items={workflows.filter((w) => w.projectId === project)}
              onContinue={() => {
                setNav("chat");
                setText(continueArtifactPrompt());
              }}
              onRestore={async (id, revision) => {
                try {
                  await api("workflows", "PATCH", {
                    id,
                    restoreRevision: revision,
                  });
                  await refresh();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
              onFork={async (id, revision) => {
                try {
                  await api("workflows", "PATCH", {
                    id,
                    fork: true,
                    forkRevision: revision,
                  });
                  await refresh();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            />
            <details className="workbench-disclosure">
              <summary>進階 · 活動與文案</summary>
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
              <summary>參考</summary>
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
                      onClick={() => openPreview(m)}
                    >
                      {m.kind === "image" ? (
                        <img
                          src={"/api/materials?id=" + m.id + "&thumb=1"}
                          alt={m.title}
                          loading="lazy"
                        />
                      ) : (
                        <AttachmentCover material={m} />
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
                        navigate("chat");
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
                <h2>還沒有素材</h2>
                <p>上傳圖片，或收藏連結。</p>
              </div>
            )}
          </section>
        ) : nav === "inspiration" ? (
          <section
            className="secondary-page"
            ref={secondaryPage}
            onScroll={(e) => rememberPageScroll(e.currentTarget)}
          >
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
              notice="公開可取得來源，不是完整 Instagram／Pinterest。"
            />
            <details
              className="knowledge-disclosure"
              onToggle={(event) =>
                setKnowledgeOpen(event.currentTarget.open)
              }
            >
              <summary>進階 · Drive 索引</summary>
              {knowledgeOpen ? <KnowledgeArchive /> : null}
            </details>
          </section>
        ) : nav === "agents" ? (
          <section
            className="secondary-page"
            ref={secondaryPage}
            onScroll={(e) => rememberPageScroll(e.currentTarget)}
          >
            <h1 className="sr-only">Hermes</h1>
            <RuntimeInspector
              task={currentTask}
              health={health}
              animation={prefs.animation}
            >
              <AgentPanel
                agents={agents.filter(
                  (agent) =>
                    agent.role === "general" || agent.status !== "unconfigured",
                )}
                brain={[]}
              />
            </RuntimeInspector>
          </section>
        ) : (
          <section
            className="secondary-page"
            ref={secondaryPage}
            onScroll={(e) => rememberPageScroll(e.currentTarget)}
          >
            <h1>任務</h1>
            <ArtifactDeck
              items={workflows.filter((w) => w.projectId === project)}
              onContinue={() => {
                setNav("chat");
                setText(continueArtifactPrompt());
              }}
              onRestore={async (id, revision) => {
                try {
                  await api("workflows", "PATCH", {
                    id,
                    restoreRevision: revision,
                  });
                  await refresh();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
              onFork={async (id, revision) => {
                try {
                  await api("workflows", "PATCH", {
                    id,
                    fork: true,
                    forkRevision: revision,
                  });
                  await refresh();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            />
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
                              setText(continueDirectionPrompt(index));
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
                      查看製作結果
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
                    {taskProgressLabel(t)}
                  </span>
                </button>
              ))}
          </section>
        )}
      </main>
      <AppDock nav={nav} onNavigate={navigate} />
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
              {panel === "spatial" ? "Hermes" : panel === "settings"
                ? "設定"
                : panel === "preview"
                  ? "素材預覽"
                  : "進度"}
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
          {panel === "spatial" ? <SpatialPanel key={project} projectId={project} task={currentTask}
            onTask={()=>openTask(currentTask)}
            onMemory={()=>{setSettingsTab("工作區");setPanel("settings");}}
            onNavigate={next=>{setPanel(null);navigate(next);}} /> : panel === "settings" ? (
            <>
              <SettingsTabs value={settingsTab} onChange={setSettingsTab} />
              <div
                role="tabpanel"
                id="setting-panel"
                aria-labelledby={"setting-tab-" + settingsTab}
                tabIndex={0}
              >
                {settingsTab === "帳號" ? (
                  <AccountSettings />
                ) : settingsTab === "外觀" ? (
                  <AppearanceSettings
                    prefs={prefs}
                    onChange={setPrefs}
                    onReset={() => setPrefs(DEFAULT_PREFS)}
                  />
                ) : settingsTab === "連線" ? (
                  <div className="settings-stack">
                    <ConnectionSettings
                      canvaState={
                        integrations.find((item) => item.id === "canva")
                          ?.state || "unknown"
                      }
                      canva={
                        <section
                          className="canva-connection"
                          aria-label="Canva 授權"
                        >
                          <h3>Canva · 授權</h3>
                          <p>
                            {canvaConfigured
                              ? "已設定 Canva 授權；請前往 Canva 確認權限。此授權只用於 Canva。"
                              : "尚未設定 Canva 授權。也可使用 Hermes 既有的 Canva 連線。"}
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
                        </section>
                      }
                      onChanged={async () => {
                        try {
                          setHealth(await api<Health>("health", "POST", {}));
                          const result = await api<{
                            integrations: Integration[];
                          }>("integrations");
                          setIntegrations(result.integrations);
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    />

                    <details className="connection-advanced">
                      <summary>進階 · 工具、技能與驗證證據</summary>
                      <IntegrationHealth items={integrations} />
                      <CapabilityCertification />
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
                    </details>
                  </div>
                ) : settingsTab === "工作區" ? (
                  <div className="settings-stack">
                    <SharedMemory projectId={project} />
                    <h3>專案</h3>
                    <p>目前有 {data.projects.length} 個專案</p>
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
                    <details className="connection-advanced">
                      <summary>進階 · 學習紀錄與會話</summary>
                      <LearningMap
                        key={project}
                        projectId={project}
                        skills={health?.skills || []}
                        materials={data.materials}
                        onTask={(id) => {
                          setSelectedTask(id);
                          setPanel("task");
                        }}
                      />
                      <p>{data.memory.scope}</p>
                      <p className="muted">
                        學習地圖是這次要求的紀錄，不是遠端記憶副本。
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
                        <button onClick={importLegacy}>
                          匯入舊版瀏覽器對話
                        </button>
                      )}
                    </details>
                  </div>
                ) : (
                  <div className="settings-stack">
                    <details className="connection-storage">
                      <summary>Hermes · 健康與驗證</summary>
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
                    </details>
                    <HelpPage />
                    <p>
                      僅顯示 Hermes
                      回傳的統計。未知費用不是零，也不推測外部工具費用。
                    </p>
                    {tasks.map((t) => (
                      <details key={t.id}>
                        <summary>{t.input.slice(0, 40)}</summary>
                        <TaskUsageSummary task={t} />
                      </details>
                    ))}
                    {!tasks.length && (
                      <p className="muted">尚無任務使用量資料。</p>
                    )}
                  </div>
                )}
              </div>
              <footer className="settings-footer">
                <p className="muted">金鑰只存在伺服器</p>
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
          ) : panel === "task" && chosenTask ? (
            <div className="settings-stack task-resume-sheet">
              <div className="task-resume-status">
                <span
                  className={
                    "badge " + (offline ? "uncertain" : chosenTask.state)
                  }
                >
                  {offline
                    ? OFFLINE_PILL_LABEL
                    : taskProgressLabel(chosenTask)}
                </span>
                <small>{time(chosenTask.updatedAt || chosenTask.createdAt)}</small>
              </div>
              <TaskRequestSummary input={chosenTask.input} />
              {offline && (
                <div className="task-offline-banner" role="status">
                  <p>連線中斷 · 顯示上次內容</p>
                  <button
                    type="button"
                    className="task-resume-cta"
                    onClick={() =>
                      void refresh().catch(() => setOffline(true))
                    }
                  >
                    重新整理
                  </button>
                </div>
              )}
              {chosenTask.state === "uncertain" && (
                <div className="task-uncertain-block" role="status">
                  <p>
                    結果待確認，此對話暫時不能再送出。請確認後再送，或另開對話重試；系統不會自動重送上一則。
                  </p>
                  <button
                    type="button"
                    className="task-resume-cta"
                    onClick={() => void acknowledgeTask(chosenTask)}
                  >
                    <RefreshCw size={16} aria-hidden="true" />
                    確認並可重試
                  </button>
                  <button
                    type="button"
                    className="text-button task-resume-cta"
                    onClick={() => retryBranchFromTask(chosenTask)}
                    disabled={busy}
                  >
                    另開對話重試
                  </button>
                </div>
              )}
              {isActive(chosenTask) && (
                <button
                  type="button"
                  className="task-resume-cta"
                  onClick={() => stopTask(chosenTask)}
                >
                  <Square size={16} />
                  要求停止
                  {!chosenTask.stopSupported ? "（無法確認已停止）" : ""}
                </button>
              )}
              {["failed", "cancelled"].includes(chosenTask.state) && (
                <button
                  type="button"
                  className="text-button task-resume-cta"
                  onClick={() => retryBranchFromTask(chosenTask)}
                  disabled={busy}
                >
                  另開對話重試
                </button>
              )}
              {!!chosenTask.output && (
                <>
                  <details className="task-output-preview">
                    <summary>輸出預覽</summary>
                    <MessageBody text={chosenTask.output} />
                  </details>
                  <button
                    type="button"
                    className="task-resume-cta"
                    onClick={() => {
                      const c = data.conversations.find(
                        (c) => c.id === chosenTask.conversationId,
                      );
                      if (c) selectConversation(c);
                      closePanel();
                    }}
                  >
                    回到對話
                  </button>
                  <button
                    type="button"
                    className="text-button task-resume-cta"
                    onClick={() => download(chosenTask)}
                  >
                    <Download size={16} />
                    下載文字成果
                  </button>
                </>
              )}
              {!chosenTask.output && (
                <button
                  type="button"
                  className="task-resume-cta"
                  onClick={() => {
                    const c = data.conversations.find(
                      (c) => c.id === chosenTask.conversationId,
                    );
                    if (c) selectConversation(c);
                    closePanel();
                  }}
                >
                  回到對話
                </button>
              )}
              {shortTaskError(chosenTask.error) && (
                <p className="error">{shortTaskError(chosenTask.error)}</p>
              )}
              {shortTaskError(chosenTask.observationError) && (
                <p className="error">
                  {shortTaskError(chosenTask.observationError)}
                </p>
              )}
              <AgentActivity task={chosenTask} />
              <details className="task-technical">
                <summary>
                  <Code2 size={15} aria-hidden="true" />
                  進階 · 紀錄
                </summary>
                <dl>
                  <div>
                    <dt>Console 任務</dt>
                    <dd>
                      <code>{chosenTask.id}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>Hermes 任務</dt>
                    <dd>
                      <code>
                        {chosenTask.remoteId || "串流模式／尚未取得"}
                      </code>
                    </dd>
                  </div>
                </dl>
                <TaskUsageSummary task={chosenTask} />
                {chosenTask.plan?.steps?.length ? (
                  <>
                    <h3>執行計畫</h3>
                    <ol className="task-plan">
                      {chosenTask.plan.steps.map((step) => (
                        <li key={step.id}>
                          {step.title}
                          <small>{step.purpose}</small>
                        </li>
                      ))}
                    </ol>
                    {chosenTask.plan.fallbacks.map((item) => (
                      <p key={item.userVisible} className="muted">
                        {item.userVisible}
                      </p>
                    ))}
                  </>
                ) : null}
                {chosenTask.events.map((e) => (
                  <details className="event" key={e.id}>
                    <TaskEventSummary event={e} />
                    <small className="event-meta">
                      {time(e.startedAt)}
                      {e.toolName && <code>{e.toolName}</code>}
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
              </details>
            </div>
          ) : panel === "task" ? (
            <div className="empty-state">
              <ListTodo size={28} />
              <p>
                尚未開始任務。
                <br />
                龜龜只會顯示真實的執行狀態。
              </p>
            </div>
          ) : null}
        </div>
      </dialog>
    </div>
  );
}
