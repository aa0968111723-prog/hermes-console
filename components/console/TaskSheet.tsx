"use client";

import { Code2, Download, RefreshCw, Square } from "lucide-react";
import type { Task } from "@/lib/contracts";
import MessageBody from "../MessageBody";
import {
  OFFLINE_PILL_LABEL,
  shortTaskError,
} from "../visual/ComposerTaskStatus";
import TaskEventSummary from "../visual/TaskEventSummary";
import TaskRequestSummary from "../visual/TaskRequestSummary";
import TaskUsageSummary from "../visual/TaskUsageSummary";
import {
  formatWorkspaceTime,
  isActiveTask,
  taskLabels,
} from "@/lib/client/workspace-ui";

export default function TaskSheet({
  task,
  offline,
  busy,
  onRefresh,
  onAcknowledge,
  onRetryBranch,
  onStop,
  onBackToChat,
  onDownload,
}: {
  task: Task;
  offline: boolean;
  busy: boolean;
  onRefresh: () => void;
  onAcknowledge: (task: Task) => void;
  onRetryBranch: (task: Task) => void;
  onStop: (task: Task) => void;
  onBackToChat: () => void;
  onDownload: (task: Task) => void;
}) {
  return (
    <div className="settings-stack task-resume-sheet">
      <div className="task-resume-status">
        <span className={"badge " + (offline ? "uncertain" : task.state)}>
          {offline ? OFFLINE_PILL_LABEL : taskLabels[task.state]}
        </span>
        <small>{formatWorkspaceTime(task.updatedAt || task.createdAt)}</small>
      </div>
      <TaskRequestSummary input={task.input} />
      {offline && (
        <div className="task-offline-banner" role="status">
          <p>連線中斷 · 顯示上次已知。後端未假裝停止。</p>
          <button type="button" className="task-resume-cta" onClick={onRefresh}>
            重新整理
          </button>
        </div>
      )}
      {task.state === "uncertain" && (
        <div className="task-uncertain-block" role="status">
          <p>
            結果待確認，此對話暫時不能再送出。請確認後再重試，或建立分支保留原紀錄；系統不會自動重送上一則。
          </p>
          <button
            type="button"
            className="task-resume-cta"
            onClick={() => void onAcknowledge(task)}
          >
            <RefreshCw size={16} aria-hidden="true" />
            確認並可重試
          </button>
          <button
            type="button"
            className="text-button task-resume-cta"
            onClick={() => onRetryBranch(task)}
            disabled={busy}
          >
            建立重試分支
          </button>
        </div>
      )}
      {isActiveTask(task) && (
        <button
          type="button"
          className="task-resume-cta"
          onClick={() => onStop(task)}
        >
          <Square size={16} />
          要求停止
          {!task.stopSupported ? "（無法確認上游停止）" : ""}
        </button>
      )}
      {["failed", "cancelled"].includes(task.state) && (
        <button
          type="button"
          className="text-button task-resume-cta"
          onClick={() => onRetryBranch(task)}
          disabled={busy}
        >
          建立重試分支（保留原紀錄）
        </button>
      )}
      {!!task.output && (
        <>
          <details className="task-output-preview">
            <summary>輸出預覽</summary>
            <MessageBody text={task.output} />
          </details>
          <button
            type="button"
            className="task-resume-cta"
            onClick={onBackToChat}
          >
            回到對話
          </button>
          <button
            type="button"
            className="text-button task-resume-cta"
            onClick={() => onDownload(task)}
          >
            <Download size={16} />
            下載文字成果
          </button>
        </>
      )}
      {!task.output && (
        <button
          type="button"
          className="task-resume-cta"
          onClick={onBackToChat}
        >
          回到對話
        </button>
      )}
      {shortTaskError(task.error) && (
        <p className="error">{shortTaskError(task.error)}</p>
      )}
      {shortTaskError(task.observationError) && (
        <p className="error">{shortTaskError(task.observationError)}</p>
      )}
      <details className="task-technical">
        <summary>
          <Code2 size={15} aria-hidden="true" />
          技術資訊
        </summary>
        <dl>
          <div>
            <dt>Console 任務</dt>
            <dd>
              <code>{task.id}</code>
            </dd>
          </div>
          <div>
            <dt>追蹤</dt>
            <dd>
              <code>{task.traceId || "尚未建立"}</code>
            </dd>
          </div>
          <div>
            <dt>專案</dt>
            <dd>
              <code>{task.projectId || "尚未標示"}</code>
            </dd>
          </div>
          <div>
            <dt>Hermes 任務</dt>
            <dd>
              <code>{task.remoteId || "串流模式／尚未取得"}</code>
            </dd>
          </div>
        </dl>
      </details>
      <TaskUsageSummary task={task} />
      {task.plan?.steps?.length ? (
        <>
          <h3>執行計畫</h3>
          <ol className="task-plan">
            {task.plan.steps.map((step) => (
              <li key={step.id}>
                {step.title}
                <small>{step.purpose}</small>
              </li>
            ))}
          </ol>
          {task.plan.fallbacks.map((item) => (
            <p key={item.userVisible} className="muted">
              {item.userVisible}
            </p>
          ))}
        </>
      ) : null}
      <h3>真實事件紀錄</h3>
      {task.events.map((e) => (
        <details className="event" key={e.id}>
          <TaskEventSummary event={e} />
          <small className="event-meta">
            {formatWorkspaceTime(e.startedAt)}
            {e.latencyMs != null ? " · " + e.latencyMs + "ms" : ""}
            {e.toolName && <code>{e.toolName}</code>}
            {e.errorCategory ? <code>{e.errorCategory}</code> : null}
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
  );
}
