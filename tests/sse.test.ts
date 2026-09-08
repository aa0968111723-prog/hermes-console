import test from "node:test";
import assert from "node:assert/strict";
import { frames } from "../lib/server/sse";

const encoder = new TextEncoder();

function fixture(chunks: string[], onCancel = () => {}) {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(encoder.encode(chunks[index++]));
      else controller.close();
    },
    cancel: onCancel,
  });
}

async function collect(stream: ReadableStream<Uint8Array>) {
  const result = [];
  for await (const frame of frames(stream, 1000)) result.push(frame);
  return result;
}

test("SSE rejects an oversized multiline event split across small chunks", async () => {
  let cancelled = false;
  const stream = fixture(
    [
      "data: " + "x".repeat(1_000_000) + "\n",
      "data: " + "y".repeat(1_000_000) + "\n",
      "\n",
      "data: should not be consumed\n\n",
    ],
    () => { cancelled = true; },
  );
  await assert.rejects(collect(stream), { status: 502, code: "frame_too_large" });
  assert.equal(cancelled, true, "oversized events must cancel the upstream reader");
});

test("SSE enforces the cumulative event limit before an unterminated EOF frame", async () => {
  await assert.rejects(
    collect(fixture([
      "data: " + "x".repeat(1_000_000) + "\n",
      "data: " + "y".repeat(1_000_000),
    ])),
    { status: 502, code: "frame_too_large" },
  );
});

test("SSE accepts the exact payload limit and resets it for the next event", async () => {
  const first = "x".repeat(999_999);
  const second = "y".repeat(1_000_000);
  const result = await collect(fixture([
    "event: delta\r\ndata: " + first + "\r\n",
    "data: " + second + "\r\n\r",
    "\ndata: " + second + "\n\n",
  ]));
  assert.deepEqual(result, [
    { event: "delta", data: first + "\n" + second },
    { event: "message", data: second },
  ]);
});

test("SSE accepts many bounded events delivered in one large network chunk", async () => {
  const count = 2_000;
  const networkChunk = ("data: " + "x".repeat(1_000) + "\n\n").repeat(count);
  assert.ok(networkChunk.length > 2_000_000);
  let seen = 0;
  for await (const frame of frames(fixture([networkChunk]), 1000)) {
    assert.equal(frame.data.length, 1_000);
    seen++;
  }
  assert.equal(seen, count);
});

test("SSE still rejects an oversized non-data line", async () => {
  await assert.rejects(
    collect(fixture(["event: " + "x".repeat(2_000_001) + "\n\n"])),
    { status: 502, code: "frame_too_large" },
  );
});

test("SSE preserves UTF-8 across byte chunks, comments and multiline EOF data", async () => {
  const bytes = encoder.encode(": heartbeat\r\nevent: delta\r\ndata: 你好🐢\r\ndata: 第二行");
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < bytes.length) controller.enqueue(bytes.slice(index, ++index));
      else controller.close();
    },
  });
  assert.deepEqual(await collect(stream), [{ event: "delta", data: "你好🐢\n第二行" }]);
});
