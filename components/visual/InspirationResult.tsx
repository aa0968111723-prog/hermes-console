"use client";
import { Image, Link2 } from "lucide-react";
import type { InspirationSearchPack } from "@/lib/inspiration-pack";

const KIND_LABEL: Record<string, string> = {
  design: "畫面",
  layout: "版面",
  hook: "鉤子",
  cta: "行動",
  audience: "受眾",
  platform: "來源",
};

export default function InspirationResult({
  pack,
}: {
  pack: InspirationSearchPack;
}) {
  return (
    <section className="inspiration-result" aria-label="靈感方向">
      <p className="eyebrow">
        {pack.itemCount} 筆已收藏 · 未搜全站
      </p>
      <ul className="inspiration-direction-grid">
        {pack.directions.map((direction) => (
          <li key={direction.id} className="inspiration-direction-card">
            <span className="inspiration-direction-id">{direction.id}</span>
            <strong>{direction.title}</strong>
            <p>{direction.summary}</p>
            <small>
              {direction.source === "saved_references" ? "已收藏" : "社團語言"}
              {direction.confidence === "medium" ? " · 中" : " · 低"}
            </small>
          </li>
        ))}
      </ul>
      {pack.clusters.length > 0 && (
        <ul className="inspiration-cluster-rail">
          {pack.clusters.map((cluster) => (
            <li key={cluster.id}>
              <span>{KIND_LABEL[cluster.kind] || cluster.kind}</span>
              {cluster.title}
              <small>{cluster.itemIds.length}</small>
            </li>
          ))}
        </ul>
      )}
      {pack.cards.length > 0 && (
        <ul className="inspiration-thumb-rail">
          {pack.cards.map((card) => (
            <li key={card.id}>
              <a
                href={card.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {card.thumb ? (
                  <img src={card.thumb} alt="" />
                ) : card.platform === "pinterest" ? (
                  <Image size={18} aria-hidden="true" />
                ) : (
                  <Link2 size={18} aria-hidden="true" />
                )}
                <span>{card.account || card.platform}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      <p className="quiet">{pack.notice}</p>
    </section>
  );
}
