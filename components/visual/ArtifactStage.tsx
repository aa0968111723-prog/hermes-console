"use client";

import { Columns2, GitFork, Layers, MessageSquare, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import CanvaResult from "../CanvaResult";

type Revision = {
  id: string;
  artifactId: string;
  revisionId: string;
  revision: number;
  title: string;
  createdAt: string;
  preview?: Record<string, unknown> | null;
};

export default function ArtifactStage({
  design,
  artifactId,
  onContinue,
  onChanged,
}: {
  design: Record<string, unknown>;
  artifactId?: string;
  onContinue?: () => void;
  onChanged?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const confirmDialog = useRef<HTMLDialogElement>(null);
  const compareDialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [compare, setCompare] = useState(false);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (!artifactId) return;
    const response = await fetch(
      "/api/artifacts?artifactId=" + encodeURIComponent(artifactId),
      { credentials: "same-origin", cache: "no-store" },
    );
    if (!response.ok) return;
    const body = (await response.json()) as { revisions?: Revision[] };
    const rows = body.revisions || [];
    setRevisions(rows);
    setSelected((current) =>
      current && rows.some((row) => row.id === current)
        ? current
        : rows.at(-1)?.id || null,
    );
  }, [artifactId]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  useEffect(() => {
    if (confirm) confirmDialog.current?.showModal();
    else confirmDialog.current?.close();
  }, [confirm]);
  useEffect(() => {
    if (compare) compareDialog.current?.showModal();
    else compareDialog.current?.close();
  }, [compare]);

  const current = revisions.find((row) => row.id === selected) || revisions.at(-1);
  const shown = current?.preview || design;
  const previous =
    revisions.find((row) => row.revision === (current?.revision || 0) - 1) ||
    revisions[0];

  async function act(action: "restore" | "fork") {
    if (!current || busy) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/artifacts", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, id: current.id }),
        signal: AbortSignal.timeout(20_000),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "無法完成。");
      setConfirm(false);
      await load();
      onChanged?.();
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
          {current ? <small> {current.revisionId}</small> : null}
        </span>
        <div className="artifact-stage-actions">
          {revisions.length > 1 && (
            <button
              className="icon-button"
              aria-label="比較版本"
              onClick={() => setCompare(true)}
            >
              <Columns2 size={18} />
            </button>
          )}
          {current && (
            <>
              <button
                className="icon-button"
                aria-label="還原此版本"
                onClick={() => setConfirm(true)}
              >
                <RotateCcw size={18} />
              </button>
              <button
                className="icon-button"
                aria-label="建立作品副本"
                onClick={() => void act("fork")}
              >
                <GitFork size={18} />
              </button>
            </>
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
      <CanvaResult design={shown} onPreview={() => setOpen(true)} />
      {revisions.length > 0 && (
        <div className="artifact-versions" role="group" aria-label="作品版本">
          {revisions.map((row) => (
            <button
              key={row.id}
              type="button"
              aria-pressed={row.id === current?.id}
              aria-current={row.id === current?.id ? "true" : undefined}
              onClick={() => setSelected(row.id)}
            >
              {row.revisionId}
            </button>
          ))}
        </div>
      )}
      {notice && (
        <p role="alert" className="error">
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
        {open && <CanvaResult design={shown} />}
      </dialog>
      <dialog
        ref={confirmDialog}
        className="artifact-preview"
        aria-label="還原作品版本"
        onCancel={() => setConfirm(false)}
      >
        <header>
          <h2>還原 {current?.revisionId}</h2>
          <button
            className="icon-button"
            aria-label="取消還原"
            onClick={() => setConfirm(false)}
          >
            <X size={22} />
          </button>
        </header>
        <p>會新增一筆新版本，不會刪除紀錄。</p>
        <button
          className="primary"
          disabled={busy}
          onClick={() => void act("restore")}
        >
          確認還原
        </button>
      </dialog>
      <dialog
        ref={compareDialog}
        className="artifact-preview"
        aria-label="比較作品版本"
        onCancel={() => setCompare(false)}
      >
        <header>
          <h2>
            {previous?.revisionId} · {current?.revisionId}
          </h2>
          <button
            className="icon-button"
            aria-label="關閉版本比較"
            onClick={() => setCompare(false)}
          >
            <X size={22} />
          </button>
        </header>
        <div className="artifact-compare">
          {previous?.preview ? (
            <CanvaResult design={previous.preview} />
          ) : (
            <p>此版本沒有預覽</p>
          )}
          {current?.preview ? (
            <CanvaResult design={current.preview} />
          ) : (
            <CanvaResult design={design} />
          )}
        </div>
      </dialog>
    </section>
  );
}
