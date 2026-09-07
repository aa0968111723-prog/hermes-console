import { authenticate, route } from "@/lib/server/security";
import { syncRuntime, runtimeSnapshot, runtimeDiff } from "@/lib/server/hermes/sync-manager";
export const runtime = "nodejs";
export const GET = route(async req => {
  const owner = authenticate(req);
  const encoder = new TextEncoder();
  let closed = false, previous = runtimeSnapshot(owner);
  req.signal.addEventListener("abort", () => { closed = true; });
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown, id?: string) => { if (!closed) controller.enqueue(encoder.encode((id ? "id: " + id + "\n" : "") + "event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n")); };
      try {
        const initial = previous || await syncRuntime(owner);
        send("runtime.snapshot", initial, initial.hash);
        while (!closed) {
          await new Promise(resolve => setTimeout(resolve, 8_000));
          if (closed) break;
          const next = await syncRuntime(owner, { force: true });
          if (!previous || previous.hash !== next.hash || previous.status !== next.status) {
            const diff = runtimeDiff(previous, next);
            send("runtime.snapshot", next, next.hash);
            if (diff.added.length || diff.removed.length || diff.changed.length || diff.becameUnavailable.length || diff.recovered.length) send("tools.updated", diff, next.hash);
            previous = next;
          } else send("heartbeat", { at: new Date().toISOString(), snapshotHash: next.hash });
        }
      } catch { if (!closed) send("runtime.error", { message: "同步失敗，請重新整理或手動同步。" }); }
      finally { try { controller.close(); } catch {} }
    },
    cancel() { closed = true; },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
});
