"use client";
import type { KnowledgeSearchPack } from "@/lib/knowledge-pack";

const STATUS = {
  confirmed: "已核對",
  likely: "大致如此",
  unconfirmed: "尚未確認",
  conflict: "衝突",
} as const;

export default function KnowledgeResult({
  pack,
}: {
  pack: KnowledgeSearchPack;
}) {
  return (
    <section className="knowledge-result" aria-label="社團資料">
      <p className="eyebrow">社團索引 · 快照 · 不是即時</p>
      {pack.conflicts.map((conflict) => (
        <p key={conflict.label + conflict.note} className="knowledge-conflict" role="status">
          <strong>衝突 · {conflict.label}</strong>
          {conflict.note}
        </p>
      ))}
      {pack.hits.length > 0 ? (
        <ul className="knowledge-list">
          {pack.hits.map((hit) => (
            <li key={hit.id} className="knowledge-card">
              <p className="eyebrow">
                {hit.kindLabel}
                {hit.semester ? " · " + hit.semester : ""}
              </p>
              <h3>{hit.title}</h3>
              <dl>
                {hit.claims.map((claim) => (
                  <div key={claim.field}>
                    <dt>{claim.label}</dt>
                    <dd>
                      <span>{claim.value}</span>
                      <em data-status={claim.status}>{STATUS[claim.status]}</em>
                    </dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      ) : (
        <p className="quiet">沒有命中。缺的資料標未確認，不會自己補活動資料。</p>
      )}
    </section>
  );
}
