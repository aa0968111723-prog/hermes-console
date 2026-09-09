"use client";
import {
  KIND_LABELS,
  RISK_METRICS,
  TWIN_METRIC_LABELS,
} from "@/lib/server/audience/personas";
import { TWIN_METRICS, type TwinPanel } from "@/lib/server/audience/types";

function band(value: number) {
  if (value >= 58) return "高";
  if (value >= 38) return "中";
  return "低";
}

export default function FirstReactionBoard({ panel }: { panel: TwinPanel }) {
  return (
    <section className="first-reaction-board" aria-label="新生第一眼模擬">
      <header>
        <p className="eyebrow">SIMULATION · {panel.kindLabel}</p>
        <h2>十個新生怎麼看</h2>
        <p className="disclaimer">{panel.disclaimer}</p>
      </header>
      <p className="twin-compare">
        較會停：{panel.personas.find((p) => p.personaId === panel.mostLikelyToStop)?.label}
        <span>較會滑掉：{panel.personas.find((p) => p.personaId === panel.mostLikelyToDrop)?.label}</span>
      </p>
      {panel.unknowns.length > 0 && (
        <ul className="twin-unknowns">
          {panel.unknowns.map((item) => (
            <li key={item}>UNKNOWN · {item}</li>
          ))}
        </ul>
      )}
      <div className="twin-rail" role="list">
        {panel.personas.map((persona) => (
          <article
            key={persona.personaId}
            className="twin-card"
            role="listitem"
            data-pressure={persona.pressure}
          >
            <h3>{persona.label}</h3>
            <blockquote>{persona.firstReaction}</blockquote>
            <ul className="twin-why">
              {persona.why.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            <dl className="twin-metrics">
              {TWIN_METRICS.map((metric) => {
                const value = persona.scores.scores[metric];
                const risk = RISK_METRICS.has(metric);
                return (
                  <div key={metric} data-risk={risk ? "true" : "false"}>
                    <dt>{TWIN_METRIC_LABELS[metric]}</dt>
                    <dd>
                      <span
                        className="twin-bar"
                        style={{ width: `${value}%` }}
                        aria-hidden="true"
                      />
                      <small>
                        {band(value)}
                        <span className="twin-score">{value}</span>
                      </small>
                    </dd>
                  </div>
                );
              })}
            </dl>
            <p className="twin-actions">
              {persona.wouldStop ? "會停" : "會滑掉"}
              {persona.wouldWalkIn ? " · 願意走近" : " · 不敢走進"}
              {persona.wouldFillForm ? " · 願意填表" : " · 不填表"}
            </p>
          </article>
        ))}
      </div>
      <p className="quiet">
        {KIND_LABELS[panel.kind]}比較用分數，不是 98/100，也不是真實轉換率。
      </p>
    </section>
  );
}
