"use client";
import type { AudienceTwin } from "@/lib/server/audience";

export default function AudienceCard({ twin }: { twin: AudienceTwin }) {
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
