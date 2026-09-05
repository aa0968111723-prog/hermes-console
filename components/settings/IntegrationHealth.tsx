"use client";
import type { Integration } from "@/lib/server/integrations";

const labels: Record<string, string> = {
  unconfigured: "Unconfigured",
  awaiting_authorization: "Needs Authorization",
  verifying: "Verifying",
  available: "Connected",
  partial: "Partial",
  failed: "Failed",
};

export default function IntegrationHealth({
  items,
}: {
  items: Integration[];
}) {
  return (
    <ul className="integration-health">
      {items.map((item) => (
        <li key={item.id}>
          <strong>{item.name}</strong>
          <span>{labels[item.state] || item.state}</span>
          <p>{item.detail}</p>
        </li>
      ))}
    </ul>
  );
}
