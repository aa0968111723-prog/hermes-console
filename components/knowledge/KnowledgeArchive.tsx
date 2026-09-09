"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";

type Claim = {
  field: string;
  value: string | null;
  status: string;
};

type Hit = {
  score: number;
  entity: {
    id: string;
    kind: string;
    title: string;
    year: string | null;
    semester: string | null;
    claims: Claim[];
  };
};

type KnowledgePayload = {
  source?: { snapshotAt: string; live: boolean; note: string };
  result?: {
    notice: string;
    live: boolean;
    snapshotAt: string;
    hits: Hit[];
    conflicts: Array<{ field: string; values: string[]; note: string }>;
    unknowns: string[];
  };
  error?: { message: string };
};

const STATUS_LABEL: Record<string, string> = {
  VERIFIED: "已核對",
  LIKELY: "大致如此",
  UNVERIFIED: "未核對",
  CONFLICTING: "衝突",
  UNKNOWN: "未知",
};

export default function KnowledgeArchive() {
  const [query, setQuery] = useState("");
  const [payload, setPayload] = useState<KnowledgePayload | null>(null);
  const [error, setError] = useState("");

  async function load(next = query) {
    setError("");
    try {
      const response = await fetch(
        "/api/knowledge?q=" + encodeURIComponent(next),
        { credentials: "same-origin", cache: "no-store" },
      );
      const data = (await response.json()) as KnowledgePayload;
      if (!response.ok)
        throw new Error(data.error?.message || "知識索引讀取失敗。");
      setPayload(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "知識索引讀取失敗。");
    }
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/knowledge?q=", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json()) as KnowledgePayload;
        if (!response.ok)
          throw new Error(data.error?.message || "知識索引讀取失敗。");
        if (!cancelled) setPayload(data);
      })
      .catch((cause) => {
        if (!cancelled)
          setError(
            cause instanceof Error ? cause.message : "知識索引讀取失敗。",
          );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const result = payload?.result;

  return (
    <section className="knowledge-archive">
      <div className="inspiration-heading">
        <div>
          <p className="eyebrow">社團事實</p>
          <h2>Drive 知識</h2>
        </div>
      </div>
      <p className="muted">
        {result?.notice ||
          "先查禪學社 Drive 索引。沒寫進索引的日期與地點是未知，不會用 IG 補。"}
      </p>
      <form
        className="knowledge-search"
        onSubmit={(event) => {
          event.preventDefault();
          void load(query);
        }}
      >
        <label className="sr-only" htmlFor="zenclub-knowledge-q">
          搜尋活動、講師或文件
        </label>
        <input
          id="zenclub-knowledge-q"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="茶會、社博、生命靈數…"
          enterKeyHint="search"
        />
        <button type="submit">
          <Search size={18} aria-hidden="true" />
          搜尋
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      {payload?.source && (
        <p className="quiet">
          快照 {new Date(payload.source.snapshotAt).toLocaleString("zh-TW")} ·
          live={String(payload.source.live)}
        </p>
      )}
      {result?.conflicts?.length ? (
        <div className="knowledge-conflict" role="status">
          {result.conflicts.map((conflict) => (
            <p key={conflict.field}>
              <strong>衝突 · {conflict.field}</strong>
              {conflict.note}
            </p>
          ))}
        </div>
      ) : null}
      <ul className="knowledge-list">
        {result?.hits.map((hit) => (
          <li key={hit.entity.id} className="knowledge-card">
            <p className="eyebrow">
              {hit.entity.kind}
              {hit.entity.semester ? ` · ${hit.entity.semester}` : ""}
            </p>
            <h3>{hit.entity.title}</h3>
            <dl>
              {hit.entity.claims.slice(0, 6).map((claim) => (
                <div key={claim.field}>
                  <dt>{claim.field}</dt>
                  <dd>
                    <span>{claim.value || "UNKNOWN"}</span>
                    <em data-status={claim.status}>
                      {STATUS_LABEL[claim.status] || claim.status}
                    </em>
                  </dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
      {result && result.hits.length === 0 && (
        <p className="quiet">沒有命中。標 UNKNOWN，不要自行補活動資料。</p>
      )}
    </section>
  );
}
