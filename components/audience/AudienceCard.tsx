"use client";

import type { AudienceTwin } from "@/lib/server/audience";
import type { PersonaProfile } from "@/lib/server/audience-twin/types";

interface Props {
  twin?: AudienceTwin;
  persona?: PersonaProfile;
}

export function PersonaCard({ persona }: { persona: PersonaProfile }) {
  return (
    <article className="persona-profile-card">
      <div className="persona-profile-header">
        <span className="persona-profile-avatar">{persona.avatar}</span>
        <div className="persona-profile-info">
          <div className="persona-name-row">
            <strong>{persona.name}</strong>
            <span className="persona-profile-tag">{persona.tag}</span>
          </div>
          <span className="persona-profile-role">{persona.role}</span>
        </div>
        <span className={`persona-domain-pill domain-${persona.domain}`}>
          {persona.domain === "tamkang"
            ? "🏫 淡江"
            : persona.domain === "ntu"
            ? "🚲 臺大"
            : "🎓 通用"}
        </span>
      </div>

      <div className="persona-profile-body">
        <div className="persona-section">
          <span className="section-label">痛點與視角：</span>
          <p className="section-text">{persona.perspective}</p>
        </div>

        <div className="persona-section mindset">
          <span className="section-label">內心獨白：</span>
          <p className="section-text">{persona.mindset}</p>
        </div>

        <div className="persona-tags-group">
          <div className="persona-pills-row">
            <span className="pills-label">✨ 有感觸發：</span>
            <div className="pills-list">
              {persona.triggers.map((t) => (
                <span key={t} className="trigger-pill">
                  {t}
                </span>
              ))}
            </div>
          </div>

          <div className="persona-pills-row">
            <span className="pills-label">⚠️ 踩雷排斥：</span>
            <div className="pills-list">
              {persona.dislikes.map((d) => (
                <span key={d} className="dislike-pill">
                  {d}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="persona-profile-footer">
        <span>🛡️ console_fixture · AI 模擬啟發式評估（非真人受訪）</span>
      </div>
    </article>
  );
}

export default function AudienceCard({ twin, persona }: Props) {
  if (persona) {
    return <PersonaCard persona={persona} />;
  }

  if (!twin) return null;

  return (
    <section className="audience-card">
      <h2>{twin.label}</h2>
      <p className="disclaimer">
        {twin.disclaimer} simulation=true · method=ai_heuristic
      </p>
      <ul>
        {twin.facts.map((fact) => (
          <li key={fact.field}>
            <strong>{fact.field}</strong>
            <span>{fact.value}</span>
            <em>{fact.kind === "evidence" ? "Evidence" : "Hypothesis"}</em>
          </li>
        ))}
      </ul>
    </section>
  );
}

