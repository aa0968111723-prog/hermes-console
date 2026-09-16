"use client";

import { GitBranch, Layers, MessageSquare, RotateCcw, X } from "lucide-react";
import { useRef, useState, useEffect } from "react";
import CanvaResult from "../CanvaResult";
import type { Artifact } from "@/lib/server/artifacts";

export default function ArtifactStage({
  design,
  artifact,
  onContinue,
  onRestore,
  onFork,
}: {
  design: Record<string, unknown>;
  artifact?: Artifact;
  onContinue?: () => void;
  onRestore?: (revisionId: string) => void;
  onFork?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const current = artifact?.revisions.find(
    (item) => item.revisionId === artifact.currentRevisionId,
  );
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  return (
    <section className="artifact-stage" aria-label="設計成果預覽">
      <header>
        <span>
          <Layers size={16} />
          成果
          {current && <small> V{current.revision}</small>}
        </span>
        <div className="artifact-actions">
          {artifact && artifact.revisions.length > 1 && onRestore && (
            <label>
              版本
              <select
                aria-label="還原作品版本"
                value={artifact.currentRevisionId}
                onChange={(event) => {
                  if (event.target.value !== artifact.currentRevisionId)
                    onRestore(event.target.value);
                }}
              >
                {artifact.revisions.map((item) => (
                  <option key={item.revisionId} value={item.revisionId}>
                    V{item.revision}
                  </option>
                ))}
              </select>
            </label>
          )}
          {onFork && (
            <button
              className="icon-button"
              aria-label="分叉這個作品"
              onClick={onFork}
            >
              <GitBranch size={18} />
            </button>
          )}
          {onRestore && current && artifact && artifact.revisions.length > 1 && (
            <button
              className="icon-button"
              aria-label="還原成目前選取版本"
              onClick={() => onRestore(artifact.currentRevisionId)}
            >
              <RotateCcw size={18} />
            </button>
          )}
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
    </section>
  );
}
