"use client";

import { Columns2, GitFork, Layers, MessageSquare, X } from "lucide-react";
import { useRef, useState, useEffect } from "react";
import CanvaResult from "../CanvaResult";
import type { ArtifactRevision } from "@/lib/server/workflows";

export default function ArtifactStage({
  design,
  revisions = [],
  activeRevision = null,
  onContinue,
  onRestore,
  onFork,
}: {
  design: Record<string, unknown>;
  revisions?: ArtifactRevision[];
  activeRevision?: number | null;
  onContinue?: () => void;
  onRestore?: (revision: number) => void;
  onFork?: (revision: number) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const compareDialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [left, setLeft] = useState<number | null>(null);
  const [right, setRight] = useState<number | null>(null);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  const current = activeRevision ?? revisions.at(-1)?.revision ?? null;
  const leftRev = revisions.find((item) => item.revision === left);
  const rightRev = revisions.find((item) => item.revision === right);
  useEffect(() => {
    if (leftRev && rightRev) compareDialog.current?.showModal();
    else compareDialog.current?.close();
  }, [leftRev, rightRev]);
  return (
    <section className="artifact-stage" aria-label="設計成果預覽">
      <header>
        <span>
          <Layers size={16} />
          成果
          {current ? <small>V{current}</small> : null}
        </span>
        <div className="artifact-stage-actions">
          {revisions.length > 1 ? (
            <button
              className="icon-button"
              aria-label="比較版本"
              aria-pressed={comparing}
              onClick={() => {
                setComparing((value) => !value);
                setLeft(null);
                setRight(null);
              }}
            >
              <Columns2 size={18} />
            </button>
          ) : null}
          {onFork && current ? (
            <button
              className="icon-button"
              aria-label="從此版分叉"
              onClick={() => {
                if (window.confirm("建立新的作品分支？原作品與其他版本仍保留。"))
                  onFork(current);
              }}
            >
              <GitFork size={18} />
            </button>
          ) : null}
          {onContinue && (
            <button
              className="icon-button"
              aria-label="在對話修改這個作品"
              onClick={onContinue}
            >
              <MessageSquare size={18} />
            </button>
          )}
        </div>
      </header>
      <CanvaResult design={design} onPreview={() => setOpen(true)} />
      {revisions.length > 1 ? (
        <div className="artifact-versions" role="group" aria-label="作品版本">
          {revisions.map((item) => (
            <button
              key={item.revisionId}
              type="button"
              aria-label={"第 " + item.revision + " 版"}
              aria-pressed={
                comparing
                  ? item.revision === left || item.revision === right
                  : item.revision === current
              }
              onClick={() => {
                if (comparing) {
                  if (left == null) setLeft(item.revision);
                  else if (right == null && item.revision !== left)
                    setRight(item.revision);
                  else {
                    setLeft(item.revision);
                    setRight(null);
                  }
                  return;
                }
                if (item.revision === current || !onRestore) return;
                if (
                  window.confirm(
                    "顯示第 " + item.revision + " 版？其他版本仍保留。",
                  )
                )
                  onRestore(item.revision);
              }}
            >
              V{item.revision}
            </button>
          ))}
        </div>
      ) : null}
      {comparing && !right ? (
        <p className="artifact-caption">選兩個版本比較。還原仍要確認。</p>
      ) : null}
      <dialog
        ref={dialog}
        className="artifact-preview"
        aria-label="作品全螢幕預覽"
        onCancel={() => setOpen(false)}
        onClick={(e) => {
          if (e.currentTarget === e.target) setOpen(false);
        }}
      >
        <header>
          <h2>作品預覽</h2>
          <button
            className="icon-button"
            aria-label="關閉作品預覽"
            onClick={() => setOpen(false)}
          >
            <X size={22} />
          </button>
        </header>
        {open && <CanvaResult design={design} />}
      </dialog>
      <dialog
        ref={compareDialog}
        className="artifact-preview"
        aria-label="作品版本比較"
        onCancel={() => {
          setRight(null);
          setLeft(null);
          setComparing(false);
        }}
      >
        <header>
          <h2>
            V{left} · V{right}
          </h2>
          <button
            className="icon-button"
            aria-label="關閉版本比較"
            onClick={() => {
              setRight(null);
              setLeft(null);
              setComparing(false);
            }}
          >
            <X size={22} />
          </button>
        </header>
        {leftRev && rightRev ? (
          <div className="artifact-compare">
            <CanvaResult design={leftRev.design} />
            <CanvaResult design={rightRev.design} />
          </div>
        ) : null}
      </dialog>
    </section>
  );
}
