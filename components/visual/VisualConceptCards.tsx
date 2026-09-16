"use client";

import type { VisualPackView } from "@/lib/client/visual-pack";

const FACT_ROWS: Array<{
  key: "date" | "time" | "location" | "registration";
  label: string;
}> = [
  { key: "date", label: "日期" },
  { key: "time", label: "時間" },
  { key: "location", label: "地點" },
  { key: "registration", label: "報名" },
];

function httpsHref(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function overlayCta(copy: string | null | undefined) {
  if (!copy) return null;
  return httpsHref(copy) ? "報名" : copy;
}

function overlayTime(value?: string | null) {
  if (!value) return null;
  const short = value.split(/[（(]/)[0]?.trim() || value.trim();
  return short || null;
}

function overlayInfo(overlay?: Record<string, string | null>) {
  if (!overlay) return null;
  const date = overlay.date?.trim() || "";
  const time = overlayTime(overlay.time) || "";
  if (date && time) return `${date}\n${time}`;
  return date || time || null;
}

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

export default function VisualConceptCards({ pack }: { pack: VisualPackView }) {
  return (
    <section
      className="visual-concept-deck"
      aria-label="視覺概念"
      data-overlay-date={pack.overlayText?.date || undefined}
    >
      <header className="visual-concept-meta">
        <p className="visual-concept-title">{pack.title}</p>
        <p className="visual-concept-format">
          {pack.format.label}
          <span>
            {pack.format.width}×{pack.format.height}
          </span>
        </p>
        <p className="visual-concept-status">尚未出圖 · 未發佈</p>
      </header>
      <FactStrip pack={pack} />
      {pack.unknownFields.length > 0 && (
        <p className="visual-concept-unknown">
          UNKNOWN：{pack.unknownFields.join("、")}，畫面上留空。
        </p>
      )}
      <p className="visual-concept-notice">{pack.notice}</p>
      <div className="visual-concept-grid">
        {pack.concepts.map((concept) => (
          <article key={concept.id} className="visual-concept-card">
            <h3>
              概念 {concept.id}
              <small>{concept.name}</small>
            </h3>
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
