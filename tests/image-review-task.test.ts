import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";

process.env.CONSOLE_DATA_DIR = await mkdtemp(
  join(tmpdir(), "hermes-image-review-"),
);
process.env.CONSOLE_ORIGIN = "http://localhost:3295";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.CONSOLE_GATEWAY_SECRET = "";
process.env.HERMES_API_URL = "";
process.env.HERMES_API_KEY = "";
process.env.HERMES_IMAGE_INPUT = "";
process.env.MCP_REQUIRE_TASK_CONTEXT = "false";

const { submit } = await import("../lib/server/tasks");
const { put, get } = await import("../lib/server/store");
const { ApiError } = await import("../lib/server/errors");
const { saveUpload } = await import("../lib/server/materials");
const { health } = await import("../lib/server/hermes");
const { isImageReviewPack } = await import("../lib/image-review");
const { isTwinPanel } = await import("../lib/server/audience/personas");

const REVIEW = "這張哪裡可以改？";

function conv() {
  const id = randomUUID();
  put("conversation", "workspace", {
    id,
    title: "工作區畫面審查",
    projectId: "personal",
    messages: [],
    hermesSessionId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return id;
}

async function poster() {
  const png = await sharp({
    create: {
      width: 24,
      height: 32,
      channels: 3,
      background: { r: 210, g: 190, b: 90 },
    },
  })
    .png()
    .toBuffer();
  return saveUpload(
    "workspace",
    "personal",
    "茶會海報.png",
    "image/png",
    png,
  );
}

test("unconfigured Hermes reviews a poster without claiming pixel-read", async () => {
  const connection = await health("workspace", true);
  assert.notEqual(connection.credential, "valid");
  const asset = await poster();
  const conversationId = conv();
  const requestKey = randomUUID();
  const task = await submit("workspace", {
    conversationId,
    requestKey,
    input: REVIEW,
    attachments: [asset.id],
  });
  assert.equal(task.state, "completed");
  assert.equal(task.transport, "chat");
  assert.equal(task.remoteId, null);
  assert.equal(task.goal?.requiresImageReview, true);
  assert.equal(task.goal?.requiresInspiration, false);
  assert.match(task.output, /沒有讀取像素/);
  assert.match(task.output, /不是 Hermes Agent 執行/);
  assert.match(task.output, /模擬/);
  assert.doesNotMatch(task.output, /已讀取像素/);
  assert.doesNotMatch(task.output, /已看圖/);
  const tool = task.events.find(
    (event) => event.toolName === "workspace_simulate_audience",
  );
  assert.ok(tool);
  assert.equal(isImageReviewPack(tool?.result), true);
  const pack = tool?.result as { pixelRead: boolean; twinPanel: unknown };
  assert.equal(pack.pixelRead, false);
  assert.equal(isTwinPanel(pack.twinPanel), true);
  assert.equal(get("agent", "workspace", "verified"), null);
  const stored = get<{
    messages: Array<{
      role: string;
      provenance?: string;
      taskId?: string;
      content: string;
    }>;
  }>("conversation", "workspace", conversationId);
  const assistant = stored?.messages.filter((item) => item.role === "assistant");
  assert.equal(assistant?.length, 1);
  assert.equal(assistant?.[0].provenance, "workspace");
  assert.match(assistant?.[0].content || "", /沒有讀取像素/);
  const again = await submit("workspace", {
    conversationId,
    requestKey,
    input: REVIEW,
    attachments: [asset.id],
  });
  assert.equal(again.id, task.id);
});

test("image review without an image does not fake looking", async () => {
  await assert.rejects(
    () =>
      submit("workspace", {
        conversationId: conv(),
        requestKey: randomUUID(),
        input: REVIEW,
        attachments: [],
      }),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, "invalid_input");
      assert.match(error.message, /請先附上海報或圖片/);
      return true;
    },
  );
  assert.equal(get("agent", "workspace", "verified"), null);
});

test("non-review chat with an unverified image still refuses Hermes send", async () => {
  const asset = await poster();
  await assert.rejects(
    () =>
      submit("workspace", {
        conversationId: conv(),
        requestKey: randomUUID(),
        input: "只是打個招呼，今天好嗎",
        attachments: [asset.id],
      }),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, "images_unverified");
      return true;
    },
  );
});
