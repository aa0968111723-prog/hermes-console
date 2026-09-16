import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-mcp-safe-"));

const {
  isSafeReadTool,
  toolCallHasReadableContent,
  interpretVerification,
} = await import("../lib/server/mcp-registry");

test("safe-read helpers refuse destructive or empty results", () => {
  assert.equal(
    isSafeReadTool({
      name: "health",
      annotations: { readOnlyHint: true },
      inputSchema: { type: "object" },
    }),
    true,
  );
  assert.equal(
    isSafeReadTool({
      name: "publish",
      annotations: { readOnlyHint: false },
    }),
    false,
  );
  assert.equal(
    isSafeReadTool({
      name: "delete",
      annotations: { readOnlyHint: true, destructiveHint: true },
    }),
    false,
  );
  assert.equal(
    isSafeReadTool({
      name: "get",
      annotations: { readOnlyHint: true },
      inputSchema: { required: ["id"] },
    }),
    false,
  );
  assert.equal(
    toolCallHasReadableContent({ content: [{ type: "text", text: "ok" }] }),
    true,
  );
  assert.equal(
    toolCallHasReadableContent({
      isError: true,
      content: [{ type: "text", text: "ok" }],
    }),
    false,
  );
  assert.equal(
    toolCallHasReadableContent({ content: [{ type: "text", text: "  " }] }),
    false,
  );
  assert.equal(
    interpretVerification({
      initialize: true,
      toolsList: true,
      safeRead: true,
    }),
    "verified",
  );
});
