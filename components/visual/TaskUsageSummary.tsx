import { Gauge } from "lucide-react";
import type { Task } from "@/lib/contracts";
import { presentTaskUsage } from "@/lib/client/task-usage";

export default function TaskUsageSummary({ task }: { task: Task }) {
  const usage = presentTaskUsage(task);
  return (
    <section
      className="task-usage"
      data-state={usage.state}
      aria-label="任務用量"
    >
      <header className="task-usage-heading">
        <span className="task-usage-icon" aria-hidden="true">
          <Gauge size={17} />
        </span>
        <span className="task-usage-title">
          <strong>任務用量</strong>
          <small>{usage.summary}</small>
        </span>
      </header>
      {usage.highlights.length > 0 && (
        <dl className="usage-highlights">
          {usage.highlights.map((item) => (
            <div className="usage-metric" key={item.key}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {usage.details.length > 0 && (
        <details className="usage-details">
          <summary>查看明細</summary>
          <dl>
            {usage.details.map((item) => (
              <div key={item.key}>
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </section>
  );
}
