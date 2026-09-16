"use client";

import { GitBranch, Layers, MessageSquare, RotateCcw, X } from "lucide-react";
import { useRef, useState, useEffect } from "react";
import CanvaResult from "../CanvaResult";
import type { Artifact } from "@/lib/server/artifacts";
import { isDirectionBriefPack } from "@/lib/direction-brief";
import DirectionBrief from "./DirectionBrief";

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
  const [compare, setCompare] = useState(false);
  const revisions = artifact?.revisions || [];
  const current = revisions.find(
    (item) => item.revisionId === artifact?.currentRevisionId,
  );
  const previous =
    revisions.find((item) => item.revisionId !== artifact?.currentRevisionId) ||
    revisions[0];
  const [leftId, setLeftId] = useState(previous?.revisionId || "");
  const [rightId, setRightId] = useState(
    artifact?.currentRevisionId || "",
  );
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  useEffect(() => {
    setLeftId(previous?.revisionId || "");
    setRightId(artifact?.currentRevisionId || "");
  }, [artifact?.currentRevisionId, previous?.revisionId]);
  const left = revisions.find((item) => item.revisionId === leftId);
  const right = revisions.find((item) => item.revisionId === rightId);
  const spec = isDirectionBriefPack(design);
  const leftSpec = left && isDirectionBriefPack(left.design) ? left.design : null;
  const rightSpec = right && isDirectionBriefPack(right.design) ? right.design : null;
  return (
    <section
      className="artifact-stage"
      aria-label={spec ? "規格草稿預覽" : "設計成果預覽"}
    >
      <header>
        <span>
          <Layers size={16} />
          {spec ? "規格草稿" : "成果"}
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
          {revisions.length > 1 && (
            <button
              className="icon-button"
              aria-pressed={compare}
              aria-label="比較版本"
              onClick={() => setCompare((value) => !value)}
            >
              比較
            </button>
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
      {compare && left && right ? (
        <div className="artifact-compare" aria-label="版本並排預覽">
          <p className="muted">並排預覽，不是像素差異。還原仍走版本選單。</p>
          <div className="artifact-compare-panes">
            <figure>
              <label>
                左側
                <select
                  aria-label="比較左側版本"
                  value={leftId}
                  onChange={(event) => setLeftId(event.target.value)}
                >
                  {revisions.map((item) => (
                    <option key={item.revisionId} value={item.revisionId}>
                      V{item.revision}
                    </option>
                  ))}
                </select>
              </label>
              {leftSpec ? (
                <DirectionBrief brief={leftSpec} />
              ) : (
                <CanvaResult design={left.design} />
              )}
            </figure>
            <figure>
              <label>
                右側
                <select
                  aria-label="比較右側版本"
                  value={rightId}
                  onChange={(event) => setRightId(event.target.value)}
                >
                  {revisions.map((item) => (
                    <option key={item.revisionId} value={item.revisionId}>
                      V{item.revision}
                    </option>
                  ))}
                </select>
              </label>
              {rightSpec ? (
                <DirectionBrief brief={rightSpec} />
              ) : (
                <CanvaResult design={right.design} />
              )}
            </figure>
          </div>
        </div>
      ) : spec ? (
        <DirectionBrief brief={design} />
      ) : (
        <CanvaResult design={design} onPreview={() => setOpen(true)} />
      )}
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
