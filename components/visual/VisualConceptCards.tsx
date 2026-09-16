"use client";

import {
  studentFormatLabel,
  studentUnknownNotice,
  type VisualPackView,
} from "@/lib/client/visual-pack";

function Frame({
  aspect,
  zones,
  overlay,
  ctaCopy,
  includeQr,
}: {
  aspect: string;
  zones?: Record<string, { xPct: number; yPct: number; wPct: number; hPct: number }>;
  overlay?: Record<string, string | null>;
  ctaCopy?: string | null;
  includeQr?: boolean;
}) {
  const [w, h] = aspect.split(/[:/]/).map(Number);
  const ratio = w && h ? `${w} / ${h}` : "4 / 5";
  const info = overlayInfo(overlay);
  const cta = overlayCta(ctaCopy ?? overlay?.registration);
  const layers: Array<{ zone: string; text: string }> = [];
  if (overlay?.name) layers.push({ zone: "headline", text: overlay.name });
  if (info) layers.push({ zone: "info", text: info });
  if (cta) layers.push({ zone: "cta", text: cta });
  if (includeQr) layers.push({ zone: "qr", text: "QR" });
  return (
    <div className="visual-concept-frame" style={{ aspectRatio: ratio }} aria-hidden="true">
      {layers.map((layer) => {
        const zone = zones?.[layer.zone];
        const style = zone
          ? {
              left: zone.xPct + "%",
              top: zone.yPct + "%",
              width: zone.wPct + "%",
              height: zone.hPct + "%",
            }
          : undefined;
        return (
          <span
            key={layer.zone}
            className={
              zone
                ? "visual-concept-overlay"
                : "visual-concept-overlay visual-concept-overlay-stack"
            }
            data-zone={layer.zone}
            style={style}
          >
            {layer.text}
          </span>
        );
      })}
    </div>
  );
}

function FactStrip({ pack }: { pack: VisualPackView }) {
  const overlay = pack.overlayText || {};
  return (
    <dl className="visual-concept-facts">
      {FACT_ROWS.map((row) => {
        const value = overlay[row.key];
        const href = row.key === "registration" ? httpsHref(value) : null;
        const empty =
          !value &&
          (pack.unknownFields.includes(row.label) || row.key === "location");
        if (!value && !empty) return null;
        return (
          <div key={row.key} className="visual-concept-fact">
            <dt>{row.label}</dt>
            <dd data-empty={empty || undefined}>
              {href ? (
                <a href={href} target="_blank" rel="noopener noreferrer">
                  公開表單
                </a>
              ) : value ? (
                value
              ) : (
                "留空"
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function Caption({
  pack,
  conceptId,
}: {
  pack: VisualPackView;
  conceptId: "A" | "B" | "C";
}) {
  const caption = pack.captions?.[conceptId];
  if (!caption) return null;
  return (
    <section className="visual-concept-caption" aria-label="貼文文案">
      <h4>貼文文案</h4>
      <p className="visual-concept-caption-hook">{caption.hook}</p>
      <p className="visual-concept-caption-body">{caption.body}</p>
      {caption.cta ? (
        <p className="visual-concept-caption-cta">{caption.cta}</p>
      ) : null}
    </section>
  );
}

export default function VisualConceptCards({
  pack,
  selectedDirection = null,
  canvaReady = false,
  onChooseDirection,
}: {
  pack: VisualPackView;
  selectedDirection?: number | null;
  canvaReady?: boolean;
  onChooseDirection?: (workflowId: string, index: number) => void;
}) {
  const choosable = Boolean(pack.workflowId && onChooseDirection);
  const selected =
    selectedDirection != null && selectedDirection >= 0
      ? pack.concepts[selectedDirection]
      : null;
  return (
    <section
      className="visual-concept-deck"
      aria-label="視覺概念"
      data-overlay-date={pack.overlayText?.date || undefined}
      data-workflow-id={pack.workflowId || undefined}
    >
      <header className="visual-concept-meta">
        <p className="visual-concept-title">{pack.title}</p>
        <p className="visual-concept-format">
          {studentFormatLabel(pack.format.label)}
        </p>
        <p className="visual-concept-status">尚未出圖 · 未發佈</p>
      </header>
      <FactStrip pack={pack} />
      {pack.unknownFields.length > 0 && (
        <p className="visual-concept-unknown">
          {studentUnknownNotice(pack.unknownFields)}
        </p>
      )}
      <p className="visual-concept-notice">
        {pack.notice.replace(/UNKNOWN/g, "未確認")}
      </p>
      <div className="visual-concept-grid">
        {pack.concepts.map((concept, index) => (
          <article
            key={concept.id}
            className={
              "visual-concept-card" +
              (selectedDirection === index ? " selected" : "")
            }
          >
            <h3>
              概念 {concept.id}
              <small>{concept.name}</small>
            </h3>
            {choosable && (
              <button
                type="button"
                className="visual-concept-choose"
                aria-pressed={selectedDirection === index}
                onClick={() => onChooseDirection?.(pack.workflowId!, index)}
              >
                {selectedDirection === index ? "已選定" : "選這個"}
              </button>
            )}
            <Frame
              aspect={pack.format.aspect}
              zones={concept.layout?.zones}
              overlay={pack.overlayText}
              ctaCopy={concept.ctaPlacement?.copy}
              includeQr={concept.qrPlacement?.include}
            />
            <p className="visual-concept-direction">{concept.creativeDirection}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
