"use client";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { HermesRuntimeSnapshot, ToolDescriptor } from "@/lib/runtime";

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
const ToolRow = memo(function ToolRow({
  tool,
  stale,
}: {
  tool: ToolDescriptor;
  stale: boolean;
}) {
  return (
    <li className="runtime-tool">
      <details>
        <summary className="runtime-tool-summary">
          <span
            className={`runtime-status-dot ${stale ? "stale" : tool.status}`}
            aria-hidden="true"
          />
          <strong>{tool.displayName}</strong>
          <small>
            {tool.canonicalName} ·{" "}
            {tool.enabled
              ? statusLabel(stale ? "stale" : tool.status)
              : "未啟用"}
          </small>
        </summary>
        <div className="runtime-tool-detail">
          <p>{tool.description || "未提供描述。"}</p>
          <dl>
            <dt>來源</dt>
            <dd>{tool.sourceServer || tool.source}</dd>
            <dt>權限分類</dt>
            <dd>{tool.permissions.join("、")}（外部提示不代表授權）</dd>
            <dt>執行驗證</dt>
            <dd>
              {tool.lastVerifiedAt
                ? new Date(tool.lastVerifiedAt).toLocaleString("zh-TW")
                : "尚無此工具的執行驗證"}
            </dd>
            <dt>專案綁定</dt>
            <dd>
              {tool.metadata.bindingSupported
                ? "由 Console 後端檢查"
                : "尚無可強制套用的介面"}
            </dd>
          </dl>
          <details>
            <summary>輸入格式</summary>
            {Object.keys(tool.inputSchema).length ? (
              <pre>{JSON.stringify(tool.inputSchema, null, 2)}</pre>
            ) : (
              <p>此探索介面未提供輸入 schema。</p>
            )}
          </details>
          {tool.outputSchema && (
            <details>
              <summary>輸出格式</summary>
              <pre>{JSON.stringify(tool.outputSchema, null, 2)}</pre>
            </details>
          )}
        </div>
      </details>
    </li>
  );
});

export default function RuntimeInspector() {
  const [snapshot, setSnapshot] = useState<HermesRuntimeSnapshot | null>(null);
  const [stale, setStale] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [query, setQuery] = useState(""),
    [limit, setLimit] = useState(100);
  const accept = useCallback((next: HermesRuntimeSnapshot) => {
    setSnapshot((previous) =>
      previous && Date.parse(previous.fetchedAt) > Date.parse(next.fetchedAt)
        ? previous
        : next,
    );
    // Transport freshness is separate from an individual upstream's stale state.
    setStale(false);
    setError("");
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
      accept(result.snapshot);
    } catch {
      setError("同步未完成；後端可能仍在探索，可稍後重試。");
      setStale(true);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    // EventSource reconnects with Last-Event-ID; server sends a fresh full snapshot.
    // Do not start a second GET retry loop whenever the stream disconnects.
    let stream: EventSource;
    let lastEventAt = Date.now();
    const disconnected = () => {
      setStale(true);
      setError("同步連線中斷，正在重連；舊資料僅供參考。");
    };
    const connect = () => {
      stream?.close();
      stream = new EventSource("/api/runtime/events");
      lastEventAt = Date.now();
      stream.addEventListener("runtime.snapshot", (event) => {
        lastEventAt = Date.now();
        try {
          accept(JSON.parse((event as MessageEvent).data));
        } catch {
          setError("Runtime 事件格式無法解析。");
        }
      });
      stream.addEventListener("heartbeat", (event) => {
        lastEventAt = Date.now();
        try {
          const data = JSON.parse((event as MessageEvent).data);
          setStale(!!data.expired);
          setError("");
          setSnapshot((previous) =>
            previous && previous.hash === data.snapshotHash
              ? {
                  ...previous,
                  fetchedAt: data.fetchedAt,
                  lastSyncedAt: data.lastSyncedAt,
                  diagnostics: data.diagnostics,
                }
              : previous,
          );
        } catch {
          setStale(true);
        }
      });
      stream.addEventListener("runtime.error", disconnected);
      stream.onerror = disconnected;
    };
    const offline = () => {
      stream?.close();
      disconnected();
    };
    window.addEventListener("offline", offline);
    window.addEventListener("online", connect);
    if (navigator.onLine) connect();
    else disconnected();
    const watchdog = window.setInterval(() => {
      if (navigator.onLine && Date.now() - lastEventAt > 45_000) {
        disconnected();
        connect();
      }
    }, 15_000);
    return () => {
      stream?.close();
      clearInterval(watchdog);
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", connect);
    };
  }, [accept]);
  const filtered = useMemo(
    () =>
      (snapshot?.tools || []).filter((tool) =>
        `${tool.canonicalName} ${tool.description}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
      ),
    [snapshot?.tools, query],
  );
  const groups = useMemo(() => {
    const map = new Map<string, ToolDescriptor[]>();
    for (const tool of filtered.slice(0, limit)) {
      const key = tool.sourceServer || tool.source;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(tool);
    }
    return [...map.entries()];
  }, [filtered, limit]);
  return (
    <section className="runtime-inspector" aria-label="Hermes Runtime 狀態">
      <header>
        <div>
          <p className="eyebrow">Hermes Runtime</p>
          <h2>即時能力同步</h2>
        </div>
        <div className="runtime-actions">
          <button onClick={() => void refresh()} disabled={busy}>
            {busy ? "同步中…" : "重新同步"}
          </button>
          <span
            className={`runtime-state ${stale ? "stale" : snapshot?.status || "unknown"}`}
          >
            {snapshot
              ? statusLabel(stale ? "stale" : snapshot.status)
              : "尚未同步"}
          </span>
        </div>
      </header>
      {error && <p role="alert">{error}</p>}
      {snapshot && (
        <>
          <p className="muted">
            最後檢查：{new Date(snapshot.fetchedAt).toLocaleString("zh-TW")} ·{" "}
            {snapshot.diagnostics.toolCount} 個工具／
            {snapshot.diagnostics.skillCount} 個技能／
            {snapshot.diagnostics.toolsetCount} 個 Toolset
          </p>
          <p className="muted">
            探索到工具不代表已授權或已執行。未驗證的工具不會標成可用。
          </p>
          {snapshot.errors.map((message) => (
            <p key={message} className="error">
              {message}
            </p>
          ))}
          <div className="runtime-summary">
            <span>連接設定 {snapshot.agents.length}</span>
            <span>Sessions {statusLabel(snapshot.sessionsSupport)}</span>
            <span>Runs {statusLabel(snapshot.runsSupport)}</span>
            <span>Memory {statusLabel(snapshot.memorySupport)}</span>
          </div>
          <details>
            <summary>技能與 Toolsets</summary>
            {(["skills", "toolsets"] as const).map((kind) => (
              <section key={kind}>
                <h3>
                  {kind} ·{" "}
                  {statusLabel(snapshot.discovery?.[kind] || "unknown")}
                </h3>
                <ul>
                  {snapshot[kind].map((item) => (
                    <li key={item.name}>
                      {item.name}：{item.description}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </details>
          <details>
            <summary>MCP 連接 · {snapshot.mcpServers.length}</summary>
            <ul>
              {snapshot.mcpServers.map((server) => (
                <li key={server.id}>
                  <strong>{server.name}</strong> ·{" "}
                  {server.enabled ? statusLabel(server.status) : "已停用"} ·{" "}
                  {server.toolsCount} 個工具
                  {server.lastError && <p>{server.lastError}</p>}
                </li>
              ))}
            </ul>
          </details>
          <label>
            搜尋工具用途
            <input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setLimit(100);
              }}
              placeholder="例如：活動、草稿、search"
            />
          </label>
          <div className="runtime-tool-groups">
            {groups.map(([source, tools]) => (
              <details key={source} open>
                <summary>
                  {source} · {tools.length} 個工具
                </summary>
                <ul>
                  {tools.map((tool) => (
                    <ToolRow
                      key={tool.canonicalName}
                      tool={tool}
                      stale={stale}
                    />
                  ))}
                </ul>
              </details>
            ))}
          </div>
          {filtered.length > limit && (
            <button onClick={() => setLimit((value) => value + 100)}>
              顯示更多（共 {filtered.length} 個）
            </button>
          )}
          {!groups.length && <p>目前沒有符合的工具；這不代表工具已可用。</p>}
        </>
      )}
    </section>
  );
}
