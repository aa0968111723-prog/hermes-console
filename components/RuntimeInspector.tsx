"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, CircleAlert, RefreshCw } from "lucide-react";
import type { HermesRuntimeSnapshot, ToolDescriptor } from "@/lib/runtime";
import AgentOrbit from "./visual/AgentOrbit";
import type { Task, Health } from "@/lib/contracts";

const labels: Record<string, string> = {
  available: "可用",
  partial: "部分可用",
  unsupported: "不支援",
  unknown: "未知",
  stale: "過期",
  failed: "失敗",
  syncing: "同步中",
};
const statusLabel = (value: string) => labels[value] || value;

function ToolRow({ tool }: { tool: ToolDescriptor }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="runtime-tool">
      <button
        type="button"
        className="runtime-tool-summary"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span
          className={`runtime-status-dot ${tool.status}`}
          aria-hidden="true"
        />
        <strong>{tool.displayName}</strong>
        <small>
          {tool.canonicalName} · {statusLabel(tool.status)}
        </small>
        <ChevronDown
          className={open ? "is-open" : ""}
          size={15}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div className="runtime-tool-detail">
          <p>{tool.description || "未提供描述。"}</p>
          <dl>
            <dt>來源</dt>
            <dd>{tool.sourceServer || tool.source}</dd>
            <dt>權限</dt>
            <dd>{tool.permissions.join("、")}</dd>
            <dt>最後驗證</dt>
            <dd>
              {tool.lastVerifiedAt
                ? new Date(tool.lastVerifiedAt).toLocaleString("zh-TW")
                : "未知"}
            </dd>
            <dt>專案／Agent</dt>
            <dd>
              {tool.projectScope === "all"
                ? "全部專案"
                : tool.projectScope.join("、")}{" "}
              ·{" "}
              {tool.agentScope === "all"
                ? "全部 Agent"
                : tool.agentScope.join("、")}
            </dd>
          </dl>
          <details>
            <summary>Input schema</summary>
            <pre>{JSON.stringify(tool.inputSchema, null, 2)}</pre>
          </details>
        </div>
      )}
    </li>
  );
}

export default function RuntimeInspector({
  task,
  health,
  animation = true,
}: {
  task?: Task;
  health: Health | null;
  animation?: boolean;
}) {
  const [snapshot, setSnapshot] = useState<HermesRuntimeSnapshot | null>(null);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/runtime", {
        cache: "no-store",
        signal: AbortSignal.timeout(40_000),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error?.message || "無法讀取 Hermes Runtime。");
      setSnapshot(result.snapshot);
      setStale(!!result.stale || result.snapshot?.status === "stale");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  const refresh = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/runtime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh: true }),
        signal: AbortSignal.timeout(60_000),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error?.message || "Runtime 同步失敗。");
      setSnapshot(result.snapshot);
      setStale(!!result.stale || result.snapshot?.status === "stale");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load();
    const stream = new EventSource("/api/runtime/events");
    const onSnapshot = (event: Event) => {
      try {
        const next = JSON.parse(
          (event as MessageEvent).data,
        ) as HermesRuntimeSnapshot;
        setSnapshot(next);
        setStale(next.status === "stale");
        setError("");
      } catch {
        setError("Runtime 事件格式無法解析。");
      }
    };
    const onError = () => {
      setStale(true);
    };
    stream.addEventListener("runtime.snapshot", onSnapshot);
    stream.addEventListener("runtime.error", onError);
    stream.onerror = onError;
    return () => stream.close();
  }, [load]);
  const groups = useMemo(() => {
    const map = new Map<string, ToolDescriptor[]>();
    for (const tool of snapshot?.tools || []) {
      const key = tool.sourceServer || tool.source;
      map.set(key, [...(map.get(key) || []), tool]);
    }
    return [...map.entries()];
  }, [snapshot]);
  const state =
    stale || snapshot?.status === "stale"
      ? "stale"
      : snapshot?.status || "unknown";
  const availableTools =
    snapshot?.tools.filter(
      (tool) => tool.enabled && tool.status === "available",
    ).length || 0;
  return (
    <section className="runtime-inspector" aria-label="Hermes Runtime 狀態">
      <header>
        <div>
          <p className="eyebrow">系統狀態</p>
          <h2>能力中心</h2>
        </div>
        <div className="runtime-actions">
          <button onClick={() => void refresh()} disabled={busy}>
            <RefreshCw size={15} />
            {busy ? "同步中…" : "重新同步"}
          </button>
          <span className={`runtime-state ${state}`}>
            <i aria-hidden="true" />
            {snapshot ? statusLabel(state) : "尚未同步"}
          </span>
        </div>
      </header>
      {error && (
        <p role="alert" className="error">
          <CircleAlert size={15} />
          {error}
        </p>
      )}
      <div className="runtime-human-summary">
        <span>
          <i
            className={
              !stale &&
              health?.credential === "valid" &&
              health.agent === "verified"
                ? "good"
                : "unknown"
            }
            aria-hidden="true"
          />
          Hermes{" "}
          {stale
            ? "待重新驗證"
            : health?.agent === "verified" && health.credential === "valid"
              ? "已驗證"
              : "未驗證"}
        </span>
        <span>
          <i
            className={!stale && availableTools > 0 ? "good" : "unknown"}
            aria-hidden="true"
          />
          工具{" "}
          {snapshot ? `${availableTools}/${snapshot.tools.length}` : "未知"}
        </span>
        <span>
          <i
            className={
              !stale && snapshot?.memorySupport === "available"
                ? "good"
                : "unknown"
            }
            aria-hidden="true"
          />
          記憶 {snapshot ? statusLabel(snapshot.memorySupport) : "未知"}
        </span>
        {!stale && snapshot?.status === "available" && (
          <Check size={16} className="runtime-check" aria-label="狀態已同步" />
        )}
      </div>
      <AgentOrbit
        snapshot={snapshot}
        task={task}
        stale={stale}
        animation={animation}
      />
      <details className="runtime-advanced">
        <summary>Advanced · Runtime 詳情</summary>
        {snapshot && (
          <>
            <p className="muted">
              最後同步：
              {new Date(snapshot.lastSyncedAt).toLocaleString("zh-TW")} ·
              snapshot {snapshot.hash.slice(0, 10)} ·{" "}
              {snapshot.diagnostics.toolCount} 個工具／
              {snapshot.diagnostics.skillCount} 個技能／
              {snapshot.diagnostics.toolsetCount} 個 Toolset
            </p>
            {snapshot.errors.map((message) => (
              <p key={message} className="error">
                {message}
              </p>
            ))}
            <div className="runtime-summary">
              <span>Agent {snapshot.agents.length}</span>
              <span>模型 {snapshot.models.length}</span>
              <span>MCP {snapshot.mcpServers.length}</span>
              <span>Sessions {statusLabel(snapshot.sessionsSupport)}</span>
              <span>Runs {statusLabel(snapshot.runsSupport)}</span>
              <span>Memory {statusLabel(snapshot.memorySupport)}</span>
            </div>
            <div className="runtime-tool-groups">
              {groups.map(([source, tools]) => (
                <details key={source}>
                  <summary>
                    {source} · {tools.length} 個工具
                  </summary>
                  <ul>
                    {tools.map((tool) => (
                      <ToolRow key={tool.canonicalName} tool={tool} />
                    ))}
                  </ul>
                </details>
              ))}
            </div>
            {!groups.length && (
              <p>Runtime 尚未列出工具；這不代表工具已可用。</p>
            )}
          </>
        )}
      </details>
    </section>
  );
}
