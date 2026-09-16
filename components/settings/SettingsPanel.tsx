"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import dynamic from "next/dynamic";
import { ExternalLink, Plus, RefreshCw } from "lucide-react";
import type { Health, Material, Task } from "@/lib/contracts";
import type { Integration } from "@/lib/server/integrations";
import { consoleApi } from "@/lib/client/console-api";
import {
  connectionLabels,
  formatWorkspaceTime,
} from "@/lib/client/workspace-ui";
import AccountPanel from "../auth/AccountPanel";
import IntegrationHealth from "./IntegrationHealth";
import MessageBody from "../MessageBody";
import TaskUsageSummary from "../visual/TaskUsageSummary";

const ConnectionSettings = dynamic(() => import("./ConnectionSettings"));
const CapabilityCertification = dynamic(
  () => import("./CapabilityCertification"),
);
const SharedMemory = dynamic(() => import("./SharedMemory"));
const LearningMap = dynamic(() => import("../LearningMap"));
const HelpPage = dynamic(() => import("../help/HelpPage"));
const KnowledgeArchive = dynamic(
  () => import("../knowledge/KnowledgeArchive"),
);

const TABS = ["帳號", "外觀", "連線", "工作區", "進階"] as const;

export type AppearancePrefs = {
  font: number;
  width: number;
  compact: boolean;
  turtle: boolean;
  animation: boolean;
  turtleSize: number;
};

export type RemoteHistory = Array<{
  role: string;
  content: string;
  name?: string;
}>;

export default function SettingsPanel({
  settingsTab,
  onTab,
  focusConnection = null,
  prefs,
  onPrefs,
  onResetPrefs,
  health,
  onHealth,
  busy,
  onBusy,
  integrations,
  onIntegrations,
  canvaConfigured,
  search,
  onSearch,
  project,
  materials,
  memoryScope,
  conversationId,
  hermesSessionId,
  remoteHistory,
  onRemoteHistory,
  legacy,
  onImportLegacy,
  tasks,
  projectCount,
  newProject,
  onNewProject,
  onWorkspaceChanged,
  onOpenTask,
  onError,
  onNotice,
}: {
  settingsTab: string;
  onTab: (tab: string) => void;
  focusConnection?: string | null;
  prefs: AppearancePrefs;
  onPrefs: Dispatch<SetStateAction<AppearancePrefs>>;
  onResetPrefs: () => void;
  health: Health | null;
  onHealth: (health: Health) => void;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  integrations: Integration[];
  onIntegrations: (items: Integration[]) => void;
  canvaConfigured: boolean;
  search: string;
  onSearch: (value: string) => void;
  project: string;
  materials: Material[];
  memoryScope: string;
  conversationId: string | null;
  hermesSessionId: string | null;
  remoteHistory: RemoteHistory | null;
  onRemoteHistory: (history: RemoteHistory | null) => void;
  legacy: boolean;
  onImportLegacy: () => void;
  tasks: Task[];
  projectCount: number;
  newProject: string;
  onNewProject: (value: string) => void;
  onWorkspaceChanged: () => Promise<unknown>;
  onOpenTask: (id: string) => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const [creating, setCreating] = useState(false);

  async function refreshConnections() {
    onHealth(await consoleApi<Health>("health", "POST", {}));
    const result = await consoleApi<{ integrations: Integration[] }>(
      "integrations",
    );
    onIntegrations(result.integrations);
  }

  return (
    <>
      <div
        className="setting-tabs"
        role="tablist"
        aria-label="設定分類"
        onKeyDown={(event) => {
          if (
            !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
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
        {TABS.map((tab) => (
          <button
            key={tab}
            role="tab"
            id={"setting-tab-" + tab}
            aria-controls="setting-panel"
            aria-selected={settingsTab === tab}
            tabIndex={settingsTab === tab ? 0 : -1}
            onClick={() => onTab(tab)}
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
        {settingsTab === "帳號" ? (
          <AccountPanel />
        ) : settingsTab === "外觀" ? (
          <div className="settings-stack">
            <p className="muted">固定明亮介面。外觀偏好只儲存在此瀏覽器。</p>
            <label>
              文字大小
              <select
                value={prefs.font}
                onChange={(e) =>
                  onPrefs((current) => ({
                    ...current,
                    font: Number(e.target.value),
                  }))
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
                  onPrefs((current) => ({
                    ...current,
                    width: Number(e.target.value),
                  }))
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
                  onPrefs((current) => ({
                    ...current,
                    compact: e.target.checked,
                  }))
                }
              />
              緊湊訊息間距
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={prefs.turtle}
                onChange={(e) =>
                  onPrefs((current) => ({
                    ...current,
                    turtle: e.target.checked,
                  }))
                }
              />
              顯示龜龜
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={prefs.animation}
                onChange={(e) =>
                  onPrefs((current) => ({
                    ...current,
                    animation: e.target.checked,
                  }))
                }
              />
              輕柔動畫（尊重系統減少動畫設定）
            </label>
            <label>
              龜龜大小
              <select
                value={prefs.turtleSize}
                onChange={(e) =>
                  onPrefs((current) => ({
                    ...current,
                    turtleSize: Number(e.target.value),
                  }))
                }
              >
                {[72, 100, 128].map((n) => (
                  <option key={n} value={n}>
                    {n} px
                  </option>
                ))}
              </select>
            </label>
            <button onClick={onResetPrefs}>重設外觀</button>
          </div>
        ) : settingsTab === "連線" ? (
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
                  {health?.agent === "verified" ? "已有成功任務" : "未驗證"}
                </dd>
                <dt>最後連線檢查</dt>
                <dd>
                  {health ? formatWorkspaceTime(health.checkedAt) : "未知"}
                </dd>
              </dl>
              <button
                onClick={async () => {
                  onBusy(true);
                  try {
                    await refreshConnections();
                  } catch (e) {
                    onError((e as Error).message);
                  } finally {
                    onBusy(false);
                  }
                }}
                disabled={busy}
              >
                <RefreshCw size={16} />
                {busy ? "驗證中…" : "重新驗證連線"}
              </button>
            </details>
            <ConnectionSettings
              focusId={focusConnection}
              canvaState={
                integrations.find((item) => item.id === "canva")?.state ||
                "unknown"
              }
              canva={
                <section className="canva-connection" aria-label="Canva 授權">
                  <h3>Canva · 授權</h3>
                  <p>
                    {canvaConfigured
                      ? "後端已設定 OAuth；請前往 Canva 授權並確認所需權限。此授權只用於 Canva。"
                      : "後端尚未設定 Canva OAuth。也可沿用 Hermes 已有的 Canva 設計 MCP。"}
                  </p>
                  <button
                    disabled={!canvaConfigured}
                    onClick={async () => {
                      try {
                        const result = await consoleApi<{ url: string }>(
                          "canva",
                          "POST",
                          { action: "authorize" },
                        );
                        window.location.assign(result.url);
                      } catch (e) {
                        onError((e as Error).message);
                      }
                    }}
                  >
                    前往 Canva 授權 <ExternalLink size={16} />
                  </button>
                </section>
              }
              onChanged={async () => {
                try {
                  await refreshConnections();
                } catch (e) {
                  onError((e as Error).message);
                }
              }}
            />

            <details className="connection-advanced">
              <summary>Advanced · 工具、技能與驗證證據</summary>
              <IntegrationHealth items={integrations} />
              <CapabilityCertification />
              <label>
                尋找工具與技能
                <input
                  value={search}
                  onChange={(e) => onSearch(e.target.value)}
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
                      {i.verifiedAt
                        ? formatWorkspaceTime(i.verifiedAt)
                        : "未驗證"}
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
        ) : settingsTab === "進階" ? (
          <div className="settings-stack">
            <h3>記憶</h3>
            <SharedMemory projectId={project} />
            <LearningMap
              key={project}
              projectId={project}
              skills={health?.skills || []}
              materials={materials}
              onTask={(id) => onOpenTask(id)}
            />
            <p>{memoryScope}</p>
            <p className="muted">
              Console 持久化記憶，不是 Hermes 遠端鏡像。未驗證前不宣稱已同步。
            </p>
            <button
              disabled={!hermesSessionId || !conversationId}
              onClick={async () => {
                try {
                  const result = await consoleApi<{
                    remoteHistory: RemoteHistory;
                  }>("conversations?id=" + conversationId);
                  onRemoteHistory(result.remoteHistory);
                  if (!result.remoteHistory)
                    onNotice("部署版本不支援會話歷史查詢。");
                } catch (e) {
                  onError((e as Error).message);
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
              <button onClick={onImportLegacy}>匯入舊版瀏覽器對話</button>
            )}
            <h3>使用量</h3>
            <p className="muted">僅顯示 Hermes 回傳的統計。未知費用不是零。</p>
            {tasks.map((t) => (
              <details key={t.id}>
                <summary>{t.input.slice(0, 40)}</summary>
                <TaskUsageSummary task={t} />
              </details>
            ))}
            {!tasks.length && <p className="muted">尚無任務使用量資料。</p>}
            <h3>說明</h3>
            <HelpPage />
            <details>
              <summary>進階 · Drive 知識</summary>
              <KnowledgeArchive />
            </details>
          </div>
        ) : (
          <div className="settings-stack">
            <p>
              目前有 {projectCount} 個自訂專案；不包含預設個人工作區。
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setCreating(true);
                try {
                  await consoleApi("workspace", "POST", { name: newProject });
                  onNewProject("");
                  await onWorkspaceChanged();
                } catch (err) {
                  onError((err as Error).message);
                } finally {
                  setCreating(false);
                }
              }}
            >
              <label>
                新增專案
                <input
                  required
                  maxLength={80}
                  value={newProject}
                  onChange={(e) => onNewProject(e.target.value)}
                />
              </label>
              <button className="primary" disabled={creating}>
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
  );
}
