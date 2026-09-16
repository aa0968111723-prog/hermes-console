"use client";

import { useEffect, type RefObject } from "react";
import {
  ChevronDown,
  Copy,
  ListTodo,
  Pencil,
} from "lucide-react";
import type { Conversation as ConversationRecord, Material, Task } from "@/lib/contracts";
import type { Integration } from "@/lib/server/integrations";
import { formatWorkspaceTime, isActiveTask, taskLabels } from "@/lib/client/workspace-ui";
import MessageBody from "../MessageBody";
import HermesCore from "../visual/HermesCore";
import QuickActions from "../visual/QuickActions";
import AgentOrbit from "../visual/AgentOrbit";
import AgentActivity from "../visual/AgentActivity";
import VisualMessage from "../visual/VisualMessage";
import MaterialThumb from "../visual/MaterialThumb";

export default function Conversation({
  scrollRef,
  nearBottomRef,
  onJumpChange,
  activeId,
  conversation,
  currentTask,
  tasks,
  turtle,
  animation,
  turtleSize,
  offline,
  integrations,
  legacy,
  materials,
  busy,
  onOpenSpatial,
  onQuickAction,
  onImportLegacy,
  onInspectTask,
  onUseDirection,
  onOpenMaterial,
  onPickDirection,
  onContinueDesign,
  onPreview,
  onCopy,
  onBranch,
  onRetryBranch,
  onAcknowledge,
}: {
  scrollRef: RefObject<HTMLDivElement | null>;
  nearBottomRef: RefObject<boolean>;
  onJumpChange: (jump: boolean) => void;
  activeId: string | null;
  conversation?: ConversationRecord;
  currentTask?: Task;
  tasks: Task[];
  turtle: boolean;
  animation: boolean;
  turtleSize: number;
  offline: boolean;
  integrations: Integration[];
  legacy: boolean;
  materials: Material[];
  busy: boolean;
  onOpenSpatial: () => void;
  onQuickAction: (prompt: string) => void;
  onImportLegacy: () => void;
  onInspectTask: (task?: Task) => void;
  onUseDirection: (prompt: string) => void;
  onOpenMaterial: (materialId: string) => void;
  onPickDirection: (workflowId: string, index: number, title: string) => void;
  onContinueDesign: (artifactId: string) => void;
  onPreview: (material: Material) => void;
  onCopy: (value: string) => void;
  onBranch: (messageId: string, content: string) => void;
  onRetryBranch: (task: Task) => void;
  onAcknowledge: (task: Task) => void;
}) {
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const sync = () => {
      if (nearBottomRef.current) {
        scroller.scrollTop = scroller.scrollHeight;
        onJumpChange(false);
        return;
      }
      onJumpChange(
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight >=
          100,
      );
    };
    const observer = new ResizeObserver(sync);
    observer.observe(scroller);
    const inner = scroller.firstElementChild;
    if (inner) observer.observe(inner);
    return () => observer.disconnect();
  }, [
    activeId,
    conversation?.messages.length,
    nearBottomRef,
    onJumpChange,
    scrollRef,
  ]);
  return (
    <div
      className="conversation-scroll"
      ref={scrollRef}
      onScroll={(event) => {
        const el = event.currentTarget;
        nearBottomRef.current =
          el.scrollHeight - el.scrollTop - el.clientHeight < 100;
        onJumpChange(!nearBottomRef.current);
      }}
    >
      <div className="conversation" key={activeId || "new"}>
        {!conversation?.messages.length ? (
          <section className="welcome" aria-labelledby="welcome-title">
            <div className="welcome-stage">
              {turtle && (
                <HermesCore
                  task={currentTask}
                  offline={offline}
                  animation={animation}
                  size={turtleSize * 1.8}
                  onClick={onOpenSpatial}
                />
              )}
              {turtle && (
                <AgentOrbit
                  compact
                  task={currentTask}
                  integrations={integrations}
                  stale={offline}
                  animation={animation}
                />
              )}
            </div>
            <h1 id="welcome-title">今天想做什麼？</h1>
            <QuickActions onSelect={onQuickAction} />
            {legacy && (
              <button className="text-button" onClick={onImportLegacy}>
                匯入這個瀏覽器中的舊對話（不覆蓋原資料）
              </button>
            )}
          </section>
        ) : (
          <>
            {conversation.parentId && (
              <p className="branch-note">此為獨立分支，原對話仍保留。</p>
            )}
            {currentTask && isActiveTask(currentTask) && (
              <AgentActivity
                task={currentTask}
                onInspect={() => onInspectTask(currentTask)}
              />
            )}
            {conversation.messages.map((message) => (
              <article
                key={message.id}
                className={"message " + message.role}
              >
                <div className="message-byline">
                  {message.role === "user" ? "你" : "Hermes"}
                  <time dateTime={message.createdAt}>
                    {formatWorkspaceTime(message.createdAt)}
                  </time>
                  {message.provenance === "legacy_unverified" && (
                    <span>舊資料 · 未驗證</span>
                  )}
                </div>
                <div className="message-content">
                  <MessageBody text={message.content} />
                  {message.role === "assistant" && message.taskId && (
                    <VisualMessage
                      task={tasks.find((item) => item.id === message.taskId)}
                      onInspect={() =>
                        onInspectTask(
                          tasks.find((item) => item.id === message.taskId),
                        )
                      }
                      onUseDirection={onUseDirection}
                      onOpenMaterial={onOpenMaterial}
                      onPickDirection={onPickDirection}
                      onContinueDesign={onContinueDesign}
                    />
                  )}
                  {!!message.attachments?.length && (
                    <div className="message-attachments">
                      {message.attachments.map((id) => {
                        const asset = materials.find((item) => item.id === id);
                        return asset ? (
                          <button
                            key={id}
                            onClick={() => onPreview(asset)}
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
                    onClick={() => onCopy(message.content)}
                  >
                    <Copy size={15} />
                  </button>
                  {message.role === "user" && (
                    <button
                      aria-label="編輯並建立分支"
                      onClick={() => onBranch(message.id, message.content)}
                      disabled={busy}
                    >
                      <Pencil size={15} />
                    </button>
                  )}
                  {message.taskId && message.role === "assistant" && (
                    <button
                      onClick={() =>
                        onInspectTask(
                          tasks.find((item) => item.id === message.taskId),
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
              !conversation.messages.some(
                (message) =>
                  message.taskId === currentTask.id &&
                  message.role === "assistant",
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
                    onInspect={() => onInspectTask(currentTask)}
                    onUseDirection={onUseDirection}
                    onOpenMaterial={onOpenMaterial}
                    onPickDirection={onPickDirection}
                    onContinueDesign={onContinueDesign}
                  />
                  {currentTask.error && (
                    <p className="error">{currentTask.error}</p>
                  )}
                  {currentTask.observationError && (
                    <p className="error">{currentTask.observationError}</p>
                  )}
                  <button
                    className="task-summary"
                    onClick={() => onInspectTask(currentTask)}
                  >
                    <ListTodo size={16} />
                    {currentTask.events.at(-1)?.summary || "查看已保存的任務"}
                    <ChevronDown size={16} />
                  </button>
                  {["failed", "cancelled", "uncertain"].includes(
                    currentTask.state,
                  ) && (
                    <button
                      className="text-button"
                      onClick={() => onRetryBranch(currentTask)}
                    >
                      建立重試分支（保留原紀錄）
                    </button>
                  )}
                  {currentTask.state === "uncertain" && (
                    <button
                      className="text-button"
                      onClick={() => onAcknowledge(currentTask)}
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
  );
}
