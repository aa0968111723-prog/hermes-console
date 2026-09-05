import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";

// Contract fixtures only: NOT a real Hermes or an integration demo.
process.env.CONSOLE_DATA_DIR = await mkdtemp(
  join(tmpdir(), "hermes-contract-"),
);
process.env.CONSOLE_ORIGIN = "http://localhost:3210";
process.env.CONSOLE_USERNAME = "fixture-owner";
const password = randomBytes(24).toString("hex"),
  salt = randomBytes(16).toString("hex");
process.env.CONSOLE_PASSWORD_HASH =
  "scrypt:" + salt + ":" + scryptSync(password, salt, 64).toString("hex");
process.env.HERMES_API_KEY = randomBytes(24).toString("hex");
process.env.HERMES_ALLOW_LOOPBACK_HTTP = "true";
process.env.HERMES_CONNECT_TIMEOUT_MS = "1000";
process.env.HERMES_IDLE_TIMEOUT_MS = "300";
let mode = "chat",
  status = 200,
  submitted = 0,
  stopped = 0,
  lastBody: Record<string, unknown> = {};
const server = createServer(async (req, res) => {
  if (req.headers.authorization !== "Bearer " + process.env.HERMES_API_KEY) {
    res.writeHead(401).end();
    return;
  }
  let body = "";
  for await (const part of req) body += part;
  if (body) lastBody = JSON.parse(body);
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/v1/models") {
    res
      .writeHead(status)
      .end(JSON.stringify({ data: [{ id: "fixture-agent" }] }));
    return;
  }
  if (req.url === "/v1/capabilities") {
    res.end(
      JSON.stringify({
        object: "hermes.api_server.capabilities",
        features: {
          run_submission: mode === "runs",
          run_status: mode === "runs",
          run_stop: mode === "runs",
        },
      }),
    );
    return;
  }
  if (req.url === "/v1/skills" || req.url === "/v1/toolsets") {
    res.end("[]");
    return;
  }
  if (req.url === "/v1/runs") {
    submitted++;
    res.writeHead(202).end(JSON.stringify({ run_id: "fixture_run" }));
    return;
  }
  if (req.url === "/v1/runs/fixture_run/stop") {
    stopped++;
    res.end('{"status":"stopping"}');
    return;
  }
  if (req.url === "/v1/runs/fixture_run") {
    res.end(JSON.stringify({ status: stopped ? "cancelled" : "running" }));
    return;
  }
  if (req.url === "/v1/chat/completions") {
    submitted++;
    if (mode === "offline") {
      res.destroy();
      return;
    }
    res.setHeader("Content-Type", "text/event-stream");
    const payload =
      "data: " +
      JSON.stringify({
        model: "fixture-agent",
        choices: [{ delta: { content: "契約測試回覆，不是實機驗證。" } }],
      }) +
      "\r\n\r\n";
    const bytes = Buffer.from(payload);
    res.write(bytes.subarray(0, 27));
    setTimeout(
      () => {
        if (!res.destroyed) {
          res.write(bytes.subarray(27));
          res.end("data: [DONE]\n\n");
        }
      },
      mode === "slow" ? 1500 : 10,
    );
    return;
  }
  res.writeHead(404).end();
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address() as { port: number };
process.env.HERMES_API_URL = "http://127.0.0.1:" + address.port;
const security = await import("../lib/server/security");
const { get, put, list } = await import("../lib/server/store");
const { health, visibleText, streamPreview, usage } = await import(
  "../lib/server/hermes"
);
const { submit, reconcile, stop, taskFor } = await import(
  "../lib/server/tasks"
);
const authRoute = await import("../app/api/auth/route");
const taskRoute = await import("../app/api/tasks/route");
const healthRoute = await import("../app/api/health/route");
const { saveUpload, attachmentParts } = await import("../lib/server/materials");
const { integrations } = await import("../lib/server/integrations");
const cookie = security.sessionCookie(
  security.login("fixture-owner", password),
);
function request(
  path: string,
  method = "GET",
  body?: unknown,
  authorized = true,
) {
  return new Request("http://localhost:3210/api/" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: process.env.CONSOLE_ORIGIN!,
      ...(authorized ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
function conv() {
  const id = randomUUID();
  put("conversation", "owner", {
    id,
    title: "契約測試",
    projectId: "personal",
    messages: [],
    hermesSessionId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return id;
}
async function settle(id: string) {
  for (let count = 0; count < 100; count++) {
    const task = taskFor("owner", id);
    if (["failed", "uncertain", "completed", "cancelled"].includes(task.state))
      return task;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("Fixture task did not settle");
}
test("security, honest health, durable tasks, uploads and ownership", async (t) => {
  await t.test("protected API rejects anonymous requests", async () => {
    assert.equal(
      (await taskRoute.POST(request("tasks", "POST", {}, false))).status,
      401,
    );
    assert.equal(
      (await healthRoute.GET(request("health", "GET", undefined, false)))
        .status,
      401,
    );
    assert.equal(
      (await authRoute.GET(request("auth", "GET", undefined, false))).status,
      401,
    );
  });
  await t.test(
    "login requires correct password; cookies are HttpOnly and origin-bound",
    async () => {
      assert.equal(
        (
          await authRoute.POST(
            request("auth", "POST", {
              username: "fixture-owner",
              password: "wrong",
            }),
          )
        ).status,
        401,
      );
      assert.match(cookie, /HttpOnly/);
      assert.match(cookie, /SameSite=Strict/);
      assert.throws(
        () =>
          security.authenticate(
            new Request("http://localhost:3210/api/tasks", {
              headers: { Cookie: cookie, Origin: "https://attacker.example" },
            }),
            true,
          ),
        /來源/,
      );
      assert.throws(
        () =>
          security.authenticate(
            new Request("http://localhost:3210/api/tasks", {
              headers: { Cookie: "hermes_session=forged" },
            }),
          ),
        /登入/,
      );
    },
  );
  await t.test("client destinations and credentials rejected", async () => {
    assert.equal(
      (
        await healthRoute.POST(
          request("health", "POST", {
            baseUrl: "http://169.254.169.254",
            apiKey: "not-real",
          }),
        )
      ).status,
      400,
    );
  });
  await t.test("401,403,404,429 never become a working agent", async () => {
    for (const code of [401, 403, 404, 429]) {
      status = code;
      const result = await health("owner", true);
      assert.equal(result.status, "failed");
      assert.notEqual(result.agent, "verified");
      assert.equal(result.reachable, true);
      assert.equal(
        result.credential,
        [401, 403].includes(code) ? "invalid" : "unknown",
      );
    }
    status = 200;
  });
  await t.test(
    "unsupported integrations and missing usage are not available or zero",
    async () => {
      const h = await health("owner", true);
      assert.equal(h.status, "partial");
      assert.ok(
        integrations("owner", h).every((i) => i.state === "unconfigured"),
      );
      assert.equal(usage(undefined, undefined, null).totalTokens, null);
      assert.equal(usage(undefined, undefined, null).providerCost, null);
    },
  );
  await t.test(
    "split stream succeeds; idempotency prevents duplicate execution",
    async () => {
      const input = {
        conversationId: conv(),
        requestKey: randomUUID(),
        input: "契約測試",
        attachments: [],
      };
      const count = submitted;
      const task = await submit("owner", input);
      assert.equal((await submit("owner", input)).id, task.id);
      const done = await settle(task.id);
      assert.equal(done.state, "completed");
      assert.equal(done.output, "契約測試回覆，不是實機驗證。");
      assert.equal(submitted, count + 1);
      assert.equal(done.usage.totalTokens, null);
      assert.ok(get("task", "owner", task.id));
      assert.equal(get("task", "another-user", task.id), null);
      await assert.rejects(
        () => submit("owner", { ...input, input: "不同內容" }),
        /識別/,
      );
    },
  );
  await t.test(
    "network failure does not synthesize a Hermes answer",
    async () => {
      mode = "offline";
      await health("owner", true);
      const task = await submit("owner", {
        conversationId: conv(),
        requestKey: randomUUID(),
        input: "斷線契約測試",
        attachments: [],
      });
      const done = await settle(task.id);
      assert.equal(done.state, "uncertain");
      assert.equal(done.output, "");
      assert.ok(done.error);
    },
  );
  await t.test(
    "idle timeout and cancellation do not pretend remote cancellation",
    async () => {
      mode = "slow";
      await health("owner", true);
      const task = await submit("owner", {
        conversationId: conv(),
        requestKey: randomUUID(),
        input: "停止契約測試",
        attachments: [],
      });
      assert.equal((await stop("owner", task.id)).state, "uncertain");
      await settle(task.id);
      const other = await submit("owner", {
        conversationId: conv(),
        requestKey: randomUUID(),
        input: "閒置逾時",
        attachments: [],
      });
      assert.equal((await settle(other.id)).state, "uncertain");
    },
  );
  await t.test(
    "native run survives reconnect; stop reaches backend",
    async () => {
      mode = "runs";
      await health("owner", true);
      const task = await submit("owner", {
        conversationId: conv(),
        requestKey: randomUUID(),
        input: "原生任務契約",
        attachments: [],
      });
      for (let i = 0; i < 30 && !taskFor("owner", task.id).remoteId; i++)
        await new Promise((r) => setTimeout(r, 20));
      assert.equal((await reconcile("owner", task.id)).remoteId, "fixture_run");
      assert.equal((await stop("owner", task.id)).state, "stopping");
      assert.equal(stopped, 1);
      assert.equal((await reconcile("owner", task.id)).state, "cancelled");
    },
  );
  await t.test(
    "actual image bytes become image input, not filenames",
    async () => {
      const sharp = (await import("sharp")).default;
      const bytes = await sharp({
        create: { width: 2, height: 2, channels: 3, background: "#90c070" },
      })
        .png()
        .toBuffer();
      const asset = await saveUpload(
        "owner",
        "personal",
        "contract.png",
        "image/png",
        bytes,
      );
      await assert.rejects(
        () => attachmentParts("owner", [asset.id]),
        /圖片輸入/,
      );
      process.env.HERMES_IMAGE_INPUT = "true";
      const parts = await attachmentParts("owner", [asset.id]);
      assert.equal(parts[0].type, "image_url");
      assert.match(JSON.stringify(parts), /data:image\/png;base64,/);
      await assert.rejects(
        () =>
          saveUpload(
            "owner",
            "personal",
            "fake.png",
            "image/png",
            Buffer.from("not image"),
          ),
        /圖片無法/,
      );
    },
  );
  await t.test("no internal thoughts or configured secrets returned", () => {
    assert.equal(visibleText("<thought>private</thought>公開"), "公開");
    assert.equal(security.redact(process.env.HERMES_API_KEY!), "[redacted]");
    assert.ok(
      !JSON.stringify(list("task", "owner")).includes(
        process.env.HERMES_API_KEY!,
      ),
    );
    assert.ok(!JSON.stringify(lastBody).includes(password));
    const secret = process.env.HERMES_API_KEY!;
    const streamed =
      "已驗證的一般內容。".repeat(80) + "<thought>私密推理</thought>" + secret;
    for (let length = 0; length <= streamed.length; length++) {
      const preview = streamPreview(streamed.slice(0, length));
      assert.ok(!preview.includes(secret.slice(0, 12)));
      assert.ok(!preview.includes("私密推理"));
    }
  });
  await t.test("unsafe legacy implementation removed", async () => {
    await assert.rejects(() => readFile("lib/local-brain.ts"));
    await assert.rejects(() => readFile("lib/hermes-config.ts"));
  });
});
test.after(() => {
  server.closeAllConnections();
  server.close();
});
