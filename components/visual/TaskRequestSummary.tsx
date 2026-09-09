import { presentTaskInput } from "@/lib/client/task-input";

export default function TaskRequestSummary({ input }: { input: string }) {
  const request = presentTaskInput(input);
  return (
    <section className="task-request" aria-label="任務需求">
      <h3 className="task-request-preview">{request.preview}</h3>
      {request.truncated && (
        <details className="task-request-full">
          <summary>查看完整需求</summary>
          <p>{input}</p>
        </details>
      )}
    </section>
  );
}
