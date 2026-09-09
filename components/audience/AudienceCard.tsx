"use client";
import type { AudienceTwin } from "@/lib/server/audience";
import type { TwinPanel } from "@/lib/server/audience/types";
import FirstReactionBoard from "./FirstReactionBoard";

export default function AudienceCard({
  twin,
  panel,
}: {
  twin?: AudienceTwin;
  panel?: TwinPanel | null;
}) {
  return (
    <div className="audience-stack">
      {twin && (
        <section className="audience-card">
          <h2>{twin.label}</h2>
          <p className="disclaimer">
            {twin.disclaimer} simulation=true · method=rule_heuristic
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
      )}
      {panel && <FirstReactionBoard panel={panel} />}
    </div>
  );
}
