import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Conversation } from "../lib/contracts";

process.env.CONSOLE_DATA_DIR = await mkdtemp(
  join(tmpdir(), "hermes-memory-layers-"),
);
process.env.CONSOLE_ORIGIN = "http://localhost:3271";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";

const {
  saveMemory,
  listMemories,
  memoriesForContext,
  memoryDigest,
  isStaleMemory,
} = await import("../lib/server/memory");
const { put } = await import("../lib/server/store");
const {
  assembleContext,
  formatContextForInstructions,
} = await import("../lib/server/context/assembler");
const { projectContext } = await import("../lib/server/creative");

function conversation(id: string): Conversation {
  return {
    id,
    title: "層級契約",
    projectId: "personal",
    messages: [],
    hermesSessionId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

test("memory layers stay separate and stale facts are not treated as current", () => {
  const convA = randomUUID();
  const convB = randomUUID();
  const thread = saveMemory("workspace", {
    kind: "note",
    scope: "personal",
    title: "只給對話A",
    content: "這則只屬於目前這串對話。",
    conversationId: convA,
  });
  assert.equal(thread.layer, "conversation");
  assert.equal(thread.conversationId, convA);

  const runtime = saveMemory("workspace", {
    kind: "note",
    scope: "workspace",
    title: "runtime-probe",
    content: "系統 runtime 狀態，不是使用者偏好。",
    layer: "runtime",
  });
  assert.equal(runtime.layer, "runtime");

  const preference = saveMemory("workspace", {
    kind: "preference",
    scope: "workspace",
    title: "海報要明亮風",
    content: "以後海報都要明亮風。",
  });
  assert.equal(preference.layer, "preference");

  const staleId = randomUUID();
  put("shared_memory", "workspace", {
    id: staleId,
    scope: "workspace",
    kind: "fact",
    title: "過期場地",
    content: "茶會在舊禮堂。",
    tags: [],
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    revision: 1,
    source: "operator",
    createdBy: "workspace",
    importance: 0.95,
    lastUsedAt: null,
    confidence: 0.95,
    layer: "workspace",
    conversationId: null,
  });
  const stale = listMemories("workspace").find((item) => item.id === staleId);
  assert.ok(stale);
  assert.equal(isStaleMemory(stale!), true);

  assert.ok(listMemories("workspace").some((item) => item.id === runtime.id));
  assert.equal(
    memoriesForContext("workspace", "personal").some(
      (item) => item.id === runtime.id,
    ),
    false,
  );
  assert.equal(
    memoriesForContext("workspace", "personal").some(
      (item) => item.id === thread.id,
    ),
    false,
  );
  assert.ok(
    memoriesForContext("workspace", "personal", { conversationId: convA }).some(
      (item) => item.id === thread.id,
    ),
  );

  const digest = memoryDigest("workspace", "personal");
  assert.match(digest, /海報要明亮風/);
  assert.doesNotMatch(digest, /runtime-probe/);
  assert.doesNotMatch(digest, /只給對話A/);
  assert.match(digest, /過期場地/);
  assert.match(digest, /stale/);

  const packedA = assembleContext({
    owner: "workspace",
    projectId: "personal",
    conversation: conversation(convA),
    goalText: "幫我做明亮風新生海報",
    budgetMode: "balanced",
  });
  assert.ok(packedA.items.some((item) => item.title === "只給對話A"));
  assert.ok(packedA.items.some((item) => item.title === "海報要明亮風"));
  assert.equal(
    packedA.items.some((item) => item.title === "runtime-probe"),
    false,
  );
  const staleItem = packedA.items.find((item) => item.title === "過期場地");
  assert.ok(staleItem);
  assert.equal(staleItem!.stale, true);
  assert.ok(staleItem!.confidence <= 0.35);

  const packedB = assembleContext({
    owner: "workspace",
    projectId: "personal",
    conversation: conversation(convB),
    goalText: "幫我做明亮風新生海報",
    budgetMode: "balanced",
  });
  assert.equal(
    packedB.items.some((item) => item.title === "只給對話A"),
    false,
  );

  const framed = formatContextForInstructions(packedA);
  assert.match(framed, /STALE/);
  assert.match(framed, /LOW_CONFIDENCE/);
  assert.match(framed, /preference/);
  assert.doesNotMatch(framed, /runtime-probe/);

  const context = projectContext("workspace", "personal");
  assert.equal(
    context.sharedMemories.some((item) => item.title === "runtime-probe"),
    false,
  );
  assert.equal(
    context.sharedMemories.some((item) => item.title === "只給對話A"),
    false,
  );
  assert.ok(Array.isArray(context.workflows));
  const staleRow = context.sharedMemories.find(
    (item) => item.title === "過期場地",
  );
  assert.equal(staleRow?.stale, true);
  assert.equal(staleRow?.layer, "workspace");
});
