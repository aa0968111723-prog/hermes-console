import {
  runtimeSnapshot,
  runtimeSyncInflight,
  subscribeRuntime,
  syncRuntime,
  RUNTIME_STALE_MS,
} from "./sync-manager";
import { presentRuntimeSnapshot } from "./runtime-view";

// Every connection subscribes to the same publisher, not its own discovery loop.
export function runtimeStream(
  request: Request,
  owner: string,
  authorize: () => void,
  heartbeatMs = 15_000,
  operator = true,
) {
  const encoder = new TextEncoder();
  let closed = false;
  let unsubscribe = () => {};
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let finish = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      finish = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        clearInterval(heartbeat);
        request.signal.removeEventListener("abort", finish);
        try {
          controller.close();
        } catch {
          /* Consumer already cancelled. */
        }
      };
      function send(event: string, data: unknown, id?: string) {
        if (closed) return;
        try {
          authorize();
          if ((controller.desiredSize ?? 0) < -4) return finish();
          controller.enqueue(
            encoder.encode(
              `${id ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
            ),
          );
        } catch {
          finish();
        }
      }
      let lastView = "";
      const sendSnapshot = (
        snapshot: NonNullable<ReturnType<typeof runtimeSnapshot>>,
      ) => {
        const view = snapshot.hash + ":" + snapshot.status;
        if (view === lastView) return;
        lastView = view;
        send(
          "runtime.snapshot",
          presentRuntimeSnapshot(snapshot, operator),
          snapshot.hash,
        );
      };
      unsubscribe = subscribeRuntime(owner, (snapshot, diff) => {
        sendSnapshot(snapshot);
        if (
          operator &&
          (diff.added.length || diff.removed.length || diff.changed.length)
        )
          send("tools.updated", diff, snapshot.hash);
      });
      request.signal.addEventListener("abort", finish, { once: true });
      if (request.signal.aborted) return finish();
      try {
        controller.enqueue(encoder.encode(": connected\n\n"));
      } catch {
        return finish();
      }
      const snapshot = runtimeSnapshot(owner);
      // There is no durable event log. Explicit snapshot resync on a missed revision.
      // Full state is also sent for a matching ID, so a newly mounted client can initialize.
      const lastId = request.headers.get("last-event-id");
      if (lastId && lastId !== snapshot?.hash)
        send("runtime.reset", { reason: "snapshot_resync" });
      if (snapshot) sendSnapshot(snapshot);
      else
        send("heartbeat", {
          at: new Date().toISOString(),
          snapshotHash: null,
          expired: true,
        });
      void syncRuntime(owner)
        .then(sendSnapshot)
        .catch(() =>
          send("runtime.error", { message: "同步失敗，舊資料僅供參考。" }),
        );
      heartbeat = setInterval(() => {
        // Keep the stream alive even while discovery is inflight; skip only when
        // the consumer is not reading. Do not republish a full snapshot mid-sync.
        if ((controller.desiredSize ?? 0) <= 0) return;
        const current = runtimeSnapshot(owner);
        if (current && !runtimeSyncInflight(owner)) sendSnapshot(current);
        send("heartbeat", {
          at: new Date().toISOString(),
          snapshotHash: current?.hash ?? null,
          fetchedAt: current?.fetchedAt,
          lastSyncedAt: current?.lastSyncedAt,
          diagnostics: current
            ? presentRuntimeSnapshot(current, operator).diagnostics
            : undefined,
          expired:
            !current || current.diagnostics.snapshotAgeMs > RUNTIME_STALE_MS,
        });
      }, heartbeatMs);
      heartbeat.unref();
    },
    cancel() {
      finish();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
