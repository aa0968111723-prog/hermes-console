"use client";

import {
  useEffect,
  type Dispatch,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  type SetStateAction,
} from "react";
import { ArrowUp, ChevronDown, RefreshCw, Square } from "lucide-react";
import type { Material, Task } from "@/lib/contracts";
import { composerHeightLimit } from "@/lib/client/viewport";
import { taskLabels } from "@/lib/client/workspace-ui";
import Turtle from "../Turtle";
import ComposerMenu from "../visual/ComposerMenu";
import ComposerTaskStatus from "../visual/ComposerTaskStatus";
import ContextTray from "../visual/ContextTray";
import type { Upload } from "../useComposerDraft";

export default function Composer({
  jump,
  onJumpLatest,
  task,
  offline,
  onTaskPillClick,
  uncertain,
  onAcknowledge,
  onRetryBranch,
  busy,
  blocked,
  ready,
  pending,
  turtle,
  text,
  setText,
  uploads,
  references,
  materials,
  inputRef,
  uploadInputRef,
  composingRef,
  onSend,
  onStop,
  onFiles,
  onPreview,
  onRetryUpload,
  onRemoveUpload,
  onRemoveReference,
  onNavigate,
}: {
  jump: boolean;
  onJumpLatest: () => void;
  task?: Task;
  offline: boolean;
  onTaskPillClick: (task: Task) => void;
  uncertain?: Task;
  onAcknowledge: (task: Task) => void;
  onRetryBranch: (task: Task) => void;
  busy: boolean;
  blocked: boolean;
  ready: boolean;
  pending?: Task;
  turtle: {
    shown: boolean;
    size: number;
    animation: boolean;
  };
  text: string;
  setText: Dispatch<SetStateAction<string>>;
  uploads: Upload[];
  references: string[];
  materials: Material[];
  inputRef: RefObject<HTMLTextAreaElement | null>;
  uploadInputRef: RefObject<HTMLInputElement | null>;
  composingRef: RefObject<boolean>;
  onSend: () => void;
  onStop: (task: Task) => void;
  onFiles: (files: File[]) => void;
  onPreview: (material: Material) => void;
  onRetryUpload: (upload: Upload) => void;
  onRemoveUpload: (key: string) => void;
  onRemoveReference: (id: string) => void;
  onNavigate: (kind: "reference" | "canva" | "project") => void;
}) {
  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    const resize = () => {
      textarea.style.height = "auto";
      const keyboardOpen =
        document.documentElement.dataset.composerKeyboard === "open";
      const limit = composerHeightLimit(
        keyboardOpen,
        window.visualViewport?.height || window.innerHeight,
      );
      textarea.style.height = Math.min(textarea.scrollHeight, limit) + "px";
      textarea.style.overflowY =
        textarea.scrollHeight > limit ? "auto" : "hidden";
      if (
        document.activeElement === textarea &&
        textarea.selectionEnd >= textarea.value.length
      ) {
        textarea.scrollTop = textarea.scrollHeight;
      }
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
    if (textarea.parentElement) observer.observe(textarea.parentElement);
    window.visualViewport?.addEventListener("resize", resize);
    window.addEventListener("resize", resize);
    return () => {
      observer.disconnect();
      window.visualViewport?.removeEventListener("resize", resize);
      window.removeEventListener("resize", resize);
    };
  }, [text, inputRef]);

  return (
    <div className="composer-area">
      <span
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {task ? "Hermes 任務：" + taskLabels[task.state] : ""}
      </span>
      {jump && (
        <button className="jump-button" onClick={onJumpLatest}>
          <ChevronDown size={16} />
          回到最新訊息
        </button>
      )}
      {task && (
        <ComposerTaskStatus
          task={task}
          offline={offline}
          onClick={() => onTaskPillClick(task)}
        />
      )}
      {uncertain && (
        <div className="composer-uncertain-hint" role="status">
          <p>
            結果待確認，此對話暫時不能再送出。可確認後在原對話重試，或建立分支保留原紀錄；未宣稱遠端已停止。
          </p>
          <div className="composer-uncertain-actions">
            <button type="button" onClick={() => onAcknowledge(uncertain)}>
              <RefreshCw size={16} aria-hidden="true" />
              確認並可重試
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => onRetryBranch(uncertain)}
              disabled={busy}
            >
              建立重試分支（保留原紀錄）
            </button>
          </div>
        </div>
      )}
      <div className="composer-row">
        {turtle.shown && (
          <Turtle
            task={task}
            offline={offline}
            animation={turtle.animation}
            size={Math.min(turtle.size, 72)}
            compact
            onClick={() => (task ? onTaskPillClick(task) : undefined)}
          />
        )}
        <form
          id="composer"
          className="composer"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (ready) onSend();
          }}
        >
          <ContextTray
            uploads={uploads}
            references={references}
            materials={materials}
            disabled={busy}
            onPreview={onPreview}
            onRetry={onRetryUpload}
            onRemoveUpload={onRemoveUpload}
            onRemoveReference={onRemoveReference}
          />
          <textarea
            ref={inputRef}
            value={text}
            rows={1}
            maxLength={20_000}
            placeholder="想做什麼？"
            aria-label="訊息"
            aria-describedby="composer-hint"
            readOnly={busy}
            onChange={(e) => setText(e.target.value)}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={() => {
              composingRef.current = false;
            }}
            onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing &&
                !composingRef.current &&
                e.keyCode !== 229 &&
                ready
              ) {
                e.preventDefault();
                onSend();
              }
            }}
          />
          <div className="composer-tools">
            <input
              ref={uploadInputRef}
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
                onFiles(files);
              }}
            />
            <ComposerMenu
              disabled={busy}
              onUpload={(kind) => {
                if (uploadInputRef.current) {
                  uploadInputRef.current.accept =
                    kind === "image"
                      ? "image/png,image/jpeg,image/webp"
                      : "text/plain,application/pdf";
                  uploadInputRef.current.click();
                }
              }}
              onNavigate={onNavigate}
            />
            {pending ? (
              <button
                className="send-button"
                type="button"
                aria-label="停止任務"
                onClick={() => onStop(pending)}
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
                  !ready ||
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
  );
}
