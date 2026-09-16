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
  onSelect,
  selectedId,
  busy = false,
}: {
  pack: InspirationSearchPack;
  onSelect?: (id: "A" | "B" | "C") => void;
  selectedId?: "A" | "B" | "C" | null;
  busy?: boolean;
}) {
  const visibleClusters = pack.clusters.filter(
    (cluster) => cluster.itemIds.length > 0,
  );
  return (
    <section className="inspiration-result" aria-label="靈感方向">
      <p className="eyebrow">
        {pack.itemCount} 筆已收藏 · 未搜全站
      </p>
      <ul className="inspiration-direction-grid" aria-label="方向 A 到 C">
        {pack.directions.map((direction) => {
          const chosen = selectedId === direction.id;
          const card = (
            <>
              <span className="inspiration-direction-id">{direction.id}</span>
              <strong>{direction.title}</strong>
              <p>{direction.summary}</p>
              <small>
                {direction.source === "saved_references" ? "已收藏" : "社團語言"}
                {direction.confidence === "medium" ? " · 中" : " · 低"}
              </small>
              {onSelect ? (
                <span className="inspiration-pick">
                  {chosen ? "已選" : "用這個"}
                </span>
              ) : null}
            </>
          );
          return (
            <li key={direction.id}>
              {onSelect ? (
                <button
                  type="button"
                  className={
                    "inspiration-direction-card" + (chosen ? " selected" : "")
                  }
                  aria-label={"選方向 " + direction.id + "：" + direction.title}
                  aria-pressed={chosen}
                  disabled={busy}
                  onClick={() => onSelect(direction.id)}
                >
                  {card}
                </button>
              ) : (
                <div className="inspiration-direction-card">{card}</div>
              )}
            </li>
          );
        })}
      </ul>
      {visibleClusters.length > 0 && (
        <ul className="inspiration-cluster-rail">
          {visibleClusters.map((cluster) => (
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
