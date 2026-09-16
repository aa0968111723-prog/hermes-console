"use client";

import {
  studentFormatLabel,
  studentUnknownNotice,
  type VisualPackView,
} from "@/lib/client/visual-pack";

function Frame({
  aspect,
  zones,
}: {
  aspect: string;
  zones?: Record<string, { xPct: number; yPct: number; wPct: number; hPct: number }>;
}) {
  const [w, h] = aspect.split(/[:/]/).map(Number);
  const ratio = w && h ? `${w} / ${h}` : "4 / 5";
  return (
    <div className="visual-concept-frame" style={{ aspectRatio: ratio }} aria-hidden="true">
      {Object.entries(zones || {}).map(([name, zone]) => (
        <span
          key={name}
          className="visual-concept-zone"
          data-zone={name}
          style={{
            left: zone.xPct + "%",
            top: zone.yPct + "%",
            width: zone.wPct + "%",
            height: zone.hPct + "%",
          }}
        >
          {name}
        </span>
      ))}
    </div>
  );
}

export default function VisualConceptCards({ pack }: { pack: VisualPackView }) {
  return (
    <section className="visual-concept-deck" aria-label="視覺概念規格">
      <header className="visual-concept-meta">
        <p className="visual-concept-format">
          {studentFormatLabel(pack.format.label)}
        </p>
        <p className="visual-concept-status">尚未出圖 · 未發佈</p>
      </header>
      {pack.unknownFields.length > 0 && (
        <p className="visual-concept-unknown">
          {studentUnknownNotice(pack.unknownFields)}
        </p>
      )}
      <p className="visual-concept-notice">
        {pack.notice.replace(/UNKNOWN/g, "未確認")}
      </p>
      <div className="visual-concept-grid">
        {pack.concepts.map((concept) => (
          <article key={concept.id} className="visual-concept-card">
            <h3>
              概念 {concept.id}
              <small>{concept.name}</small>
            </h3>
            <Frame aspect={pack.format.aspect} zones={concept.layout?.zones} />
            <p>{concept.creativeDirection}</p>
            <ul>
              {concept.visualHierarchy.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p className="visual-concept-flags">
              {concept.qrPlacement?.include ? "可放 QR" : "省略 QR"}
              {" · "}
              {concept.ctaPlacement?.copy ? "CTA 已有文案" : "CTA 留空"}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
