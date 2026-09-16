"use client";
import { useEffect, useState } from "react";
import {
  Brain,
  Network,
  Folder,
  ListTodo,
  ArrowRight,
  RefreshCw,
} from "lucide-react";
import type { Task } from "@/lib/contracts";
import AgentActivity from "./AgentActivity";
type Memory = {
  id: string;
  title: string;
  scope: string;
  kind: string;
  content: string;
  updatedAt: string;
};
export default function SpatialPanel({
  task,
  projectId,
  onNavigate,
  onMemory,
  onTask,
}: {
  task?: Task;
  projectId: string;
  onNavigate: (nav: "agents" | "projects" | "tasks") => void;
  onMemory: () => void;
  onTask: () => void;
}) {
  const [memories, setMemories] = useState<Memory[]>([]),
    [selected, setSelected] = useState<string | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError("");
    setMemories([]);
    setSelected(null);
    fetch("/api/memory?scope=all", { cache: "no-store", signal: abort.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error?.message || "無法讀取記憶");
        setMemories(
          (body.memories as Memory[]).filter(
            (m) => m.scope === "workspace" || m.scope === projectId,
          ),
        );
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [projectId, attempt]);
  const chosen = memories.find((m) => m.id === selected);
  return (
    <div className="spatial-panel">
      <AgentActivity task={task} onInspect={onTask} />
      <div className="spatial-shortcuts">
        <button onClick={() => onNavigate("agents")}>
          <Network size={22} />
          連線
        </button>
        <button onClick={() => onNavigate("projects")}>
          <Folder size={22} />
          素材
        </button>
        <button onClick={() => onNavigate("tasks")}>
          <ListTodo size={22} />
          成果
        </button>
      </div>
      <section className="memory-constellation" aria-label="記憶">
        <header>
          <h3>
            <Brain size={19} />
            記憶
          </h3>
          <button aria-label="管理記憶" onClick={onMemory}>
            <ArrowRight size={19} />
          </button>
        </header>
        {loading ? (
          <p role="status">讀取中…</p>
        ) : error ? (
          <div role="alert">
            <p>{error}</p>
            <button onClick={() => setAttempt((n) => n + 1)}>
              <RefreshCw size={18} />
              重試
            </button>
          </div>
        ) : memories.length ? (
          <>
            <div className="memory-orbs" role="group" aria-label="記憶節點">
              {memories.slice(0, 6).map((m) => (
                <button
                  key={m.id}
                  aria-pressed={selected === m.id}
                  onClick={() => setSelected(selected === m.id ? null : m.id)}
                >
                  <span>
                    <Brain size={22} />
                  </span>
                  <strong>{m.title}</strong>
                </button>
              ))}
            </div>
            {chosen && (
              <article className="memory-node-detail">
                <h4>{chosen.title}</h4>
                <p>{chosen.content}</p>
                <small>
                  {chosen.scope === "workspace" ? "共用" : "目前專案"} ·{" "}
                  {new Date(chosen.updatedAt).toLocaleDateString("zh-TW")}
                </small>
              </article>
            )}
            <button className="text-button" onClick={onMemory}>
              檢視全部 {memories.length} 筆
            </button>
          </>
        ) : (
          <button className="memory-empty" onClick={onMemory}>
            <Brain size={24} />
            加入想讓 Hermes 記住的事
          </button>
        )}
        <small>工作區記憶 · 不代表遠端已同步</small>
      </section>
    </div>
  );
}
