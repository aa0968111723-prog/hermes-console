"use client";

import { Ban, Sparkles } from "lucide-react";
import {
  inspirationDirectionPrompt,
  type InspirationBriefView,
  type InspirationPatternView,
} from "@/lib/client/inspiration-result";
import { safeSource } from "@/lib/client/activity";

function host(url?: string) {
  const href = url ? safeSource(url) : null;
  if (!href) return null;
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export default function InspirationResult({
  brief,
  onUseDirection,
}: {
  brief: InspirationBriefView;
  onUseDirection?: (prompt: string) => void;
}) {
  const keep = brief.visualLanguage?.keep || [];
  const avoid = brief.visualLanguage?.avoid || [];
  const references = (brief.references || [])
    .map((item) => ({
      ...item,
      host: host(item.sourceUrl),
    }))
    .filter((item) => item.host);
  return (
    <section className="inspiration-result" aria-label="靈感方向">
      <p className="eyebrow">靈感 · 已保存來源</p>
      {brief.visualLanguage?.biggestProblem ? (
        <h2>{brief.visualLanguage.biggestProblem}</h2>
      ) : (
        <h2>可沿用的畫面模式</h2>
      )}
      {keep.length > 0 && (
        <ul className="pattern-rail" aria-label="可沿用">
          {keep.map((pattern) => (
            <li key={pattern.id}>
              <PatternCard
                pattern={pattern}
                onUse={
                  onUseDirection
                    ? () => onUseDirection(inspirationDirectionPrompt(pattern.title))
                    : undefined
                }
              />
            </li>
          ))}
        </ul>
      )}
      {avoid.length > 0 && (
        <ul className="pattern-rail pattern-rail-avoid" aria-label="避免">
          {avoid.map((pattern) => (
            <li key={pattern.id}>
              <PatternCard pattern={pattern} />
            </li>
          ))}
        </ul>
      )}
      {references.length > 0 && (
        <ul className="inspiration-hosts" aria-label="參考來源">
          {references.map((item) => (
            <li key={item.sourceUrl}>
              <span>{item.host}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="quiet">{brief.notice}</p>
    </section>
  );
}

function PatternCard({
  pattern,
  onUse,
}: {
  pattern: InspirationPatternView;
  onUse?: () => void;
}) {
  const avoid = pattern.suitability === "avoid";
  return (
    <article className="pattern-card" data-suitability={pattern.suitability}>
      {avoid ? <Ban size={18} aria-hidden="true" /> : <Sparkles size={18} aria-hidden="true" />}
      <h3>{pattern.title}</h3>
      <p>{pattern.summary}</p>
      {onUse && (
        <button type="button" onClick={onUse}>
          用這個方向
        </button>
      )}
    </article>
  );
}
