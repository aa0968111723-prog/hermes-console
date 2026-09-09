import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CONSOLE_DATA_DIR = await mkdtemp(
  join(tmpdir(), "hermes-memory-write-readback-"),
);
process.env.CONSOLE_ORIGIN = "http://localhost:3240";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.CONSOLE_GATEWAY_SECRET = "";
process.env.HERMES_ALLOW_LOOPBACK_HTTP = "true";

const memoryApi = await import("../app/api/memory/route");
const readyApi = await import("../app/api/ready/route");
const {
  memoryEvidenceKind,
  memoryWriteApiEnabled,
  writeMemoryWithReadBack,
  getMemory,
} = await import("../lib/server/memory");

function request(path: string, method = "GET", body?: unknown) {
  return new Request("http://localhost:3240/api/" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: process.env.CONSOLE_ORIGIN!,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("memory write + same-store read-back carries LOCAL evidence on sqlite", async () => {
  assert.equal(memoryEvidenceKind(), "LOCAL");
  assert.equal(memoryWriteApiEnabled(), true);

  const created = await memoryApi.POST(
    request("memory", "POST", {
      kind: "note",
      scope: "workspace",
      title: "readback-proof",
      content: "同一 Console store 寫入後必須讀回。",
      tags: ["proof"],
    }),
  );
  assert.equal(created.status, 201);
  const body = await created.json();
  assert.equal(body.memory.title, "readback-proof");
  assert.equal(body.readBack.id, body.memory.id);
  assert.equal(body.readBack.revision, body.memory.revision);
  assert.equal(body.evidence.kind, "LOCAL");
  assert.equal(body.evidence.readBackOk, true);
  assert.equal(body.evidence.store, "console-sqlite");
  assert.equal(body.memory_write_api, true);
  assert.equal(getMemory("workspace", body.memory.id).title, "readback-proof");

  const listed = await memoryApi.GET(request("memory?scope=all"));
  assert.equal(listed.status, 200);
  const listBody = await listed.json();
  assert.equal(listBody.share.memory_write_api, true);
  assert.equal(listBody.evidence.kind, "LOCAL");
  assert.equal(listBody.evidence.memory_write_api, true);
});

test("writeMemoryWithReadBack helper matches API proof shape", () => {
  const proof = writeMemoryWithReadBack("workspace", {
    kind: "fact",
    title: "helper",
    content: "direct helper path",
  });
  assert.equal(proof.evidence.kind, "LOCAL");
  assert.equal(proof.readBack.id, proof.memory.id);
});

test("ready exposes memory_write_api when store probe ok", async () => {
  const response = await readyApi.GET(new Request("http://localhost:3240/api/ready"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ready, true);
  assert.equal(body.memory_write_api, true);
  assert.equal(body.backend, "sqlite");
});
