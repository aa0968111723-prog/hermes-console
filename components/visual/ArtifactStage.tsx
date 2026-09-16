"use client";

import {
  Download,
  GitCompare,
  Layers,
  MessageSquare,
  RotateCcw,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Artifact } from "@/lib/server/artifacts";
import {
  continueCopyPrompt,
  continueDesignPrompt,
  revisionLabel,
} from "@/lib/client/artifacts";
import CanvaResult from "../CanvaResult";

export default function ArtifactStage({
  design,
  artifact,
  continueId,
  onContinue,
  onRestored,
}: {
  design?: Record<string, unknown> | null;
  artifact?: Artifact;
  continueId?: string;
  onContinue?: (text: string) => void;
  onRestored?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState(
    artifact?.selectedRevision || artifact?.revision || 1,
  );
  const [compare, setCompare] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  const revisions = artifact?.revisions || [];
  const current =
    revisions.find((row) => row.revision === viewing) || revisions.at(-1);
  const baseline =
    revisions.find((row) => row.revision === artifact?.selectedRevision) ||
    revisions[0];
  function prompt() {
    if (artifact) return continueCopyPrompt(artifact.artifactId, viewing);
    return continueDesignPrompt(continueId || "");
  }
  async function restore() {
    if (!artifact || busy) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/artifacts", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "restore",
          artifactId: artifact.artifactId,
          revisionId: String(viewing),
          expectedRevision: artifact.expectedRevision,
        }),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error?.message || "無法還原此版本。");
      setNotice("已還原成 " + revisionLabel(viewing) + "。");
      setConfirmRestore(false);
      onRestored?.();
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="artifact-stage" aria-label="設計成果預覽">
      <header>
        <span>
          <Layers size={16} />
          成果
          {current ? " · " + revisionLabel(current.revision) : ""}
        </span>
        {onContinue && (
          <button
            className="icon-button"
            aria-label="在對話修改這個作品"
            onClick={() => onContinue(prompt())}
          >
            <MessageSquare size={18} />
          </button>
        )}
      </header>
      {design ? (
        <CanvaResult design={design} onPreview={() => setOpen(true)} />
      ) : current ? (
        <article className="copy-result">
          <h3>{current.title}</h3>
          <p className="artifact-excerpt">{current.excerpt}</p>
        </article>
      ) : artifact?.previewUrl ? (
        <img src={artifact.previewUrl} alt="" loading="lazy" />
      ) : null}
      {revisions.length > 1 && (
        <div className="artifact-revisions" role="group" aria-label="作品版本">
          {revisions.map((row) => (
            <button
              key={row.revisionId}
              type="button"
              aria-pressed={row.revision === viewing}
              onClick={() => {
                setViewing(row.revision);
                setConfirmRestore(false);
              }}
            >
              {revisionLabel(row.revision)}
            </button>
          ))}
        </div>
      )}
      <div className="artifact-actions">
        {onContinue && (
          <button type="button" onClick={() => onContinue(prompt())}>
            修改
          </button>
        )}
        {revisions.length > 1 && (
          <button
            type="button"
            aria-pressed={compare}
            onClick={() => setCompare((value) => !value)}
          >
            <GitCompare size={16} />
            比較
          </button>
        )}
        {artifact?.source === "copy" && (
          <a
            className="button-link"
            href={
              "/api/creative?download=" +
              artifact.artifactId +
              "&revision=" +
              viewing
            }
          >
            <Download size={16} />
            匯出
          </a>
        )}
        {artifact?.source === "copy" &&
          revisions.length > 1 &&
          viewing !== artifact.selectedRevision && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmRestore(true)}
            >
              <RotateCcw size={16} />
              還原
            </button>
          )}
      </div>
      {compare && current && baseline && current.revision !== baseline.revision && (
        <div className="artifact-compare">
          <article>
            <h4>{revisionLabel(baseline.revision)}</h4>
            <p>{baseline.excerpt}</p>
          </article>
          <article>
            <h4>{revisionLabel(current.revision)}</h4>
            <p>{current.excerpt}</p>
          </article>
        </div>
      )}
      {confirmRestore && (
        <div className="artifact-confirm" role="alertdialog" aria-label="還原確認">
          <p>確定還原成 {revisionLabel(viewing)}？目前選定版本不會刪除。</p>
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => void restore()}
          >
            確定還原
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirmRestore(false)}
          >
            取消
          </button>
        </div>
      )}
      {notice && (
        <p className="muted" role="status">
          {notice}
        </p>
      )}
      <dialog
        ref={dialog}
        className="artifact-preview"
        aria-label="作品全螢幕預覽"
        onCancel={() => setOpen(false)}
        onClick={(event) => {
          if (event.currentTarget === event.target) setOpen(false);
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
        {open && design && <CanvaResult design={design} />}
      </dialog>
    </section>
  );
}
