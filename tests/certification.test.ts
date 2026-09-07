import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import type { Task } from "../lib/contracts";
import { EMPTY_USAGE } from "../lib/contracts";
import { classifyTruth, audienceTruth } from "../lib/server/truth";
import { overallFromCapabilities, evidenceKindForUrl } from "../lib/server/certification/evidence";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-cert-"));
process.env.CONSOLE_ORIGIN = "http://localhost:3255";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.CONSOLE_GATEWAY_SECRET = "";
process.env.HERMES_ALLOW_LOOPBACK_HTTP = "true";
process.env.HERMES_API_KEY = randomBytes(24).toString("hex");
delete process.env.ZEABUR_API_TOKEN;
delete process.env.ZEABUR_PROJECT_ID;
delete process.env.HERMES_IMAGE_INPUT;

const hermesQueries: string[] = [];
const hermes = createServer((req, res) => {
  hermesQueries.push(req.url || "");
  if (req.headers.authorization !== "Bearer " + process.env.HERMES_API_KEY) {
    res.writeHead(401).end();
    return;
  }
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/v1/models") {
    res.end(JSON.stringify({ data: [{ id: "fixture-agent" }] }));
    return;
  }
  if (req.url === "/v1/capabilities") {
    res.end(
      JSON.stringify({
        object: "hermes.api_server.capabilities",
        features: {
          run_submission: true,
          run_status: true,
          run_stop: true,
          memory: false,
        },
      }),
    );
    return;
  }
  if (req.url === "/v1/skills") {
    res.end(JSON.stringify([{ name: "draft", description: "fixture" }]));
    return;
  }
  if (req.url === "/v1/toolsets") {
    res.end(
      JSON.stringify([
        { name: "workspace", tools: ["workspace_list_memories"] },
      ]),
    );
    return;
  }
  res.writeHead(404).end();
});
await new Promise<void>((resolve) => hermes.listen(0, "127.0.0.1", resolve));
process.env.HERMES_API_URL =
  "http://127.0.0.1:" + (hermes.address() as { port: number }).port;

const zeaburQueries: string[] = [];
const zeabur = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (part) => chunks.push(part));
  req.on("end", () => {
    const raw = Buffer.concat(chunks).toString("utf8");
    let body: { query?: string } = {};
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      body = {};
    }
    zeaburQueries.push(body.query || "");
    res.setHeader("Content-Type", "application/json");
    if (body.query?.includes("me {")) {
      res.end(JSON.stringify({ data: { me: { username: "owner" } } }));
      return;
    }
    if (body.query?.includes("project(id")) {
      res.end(JSON.stringify({ data: { project: { name: "hermes-console" } } }));
      return;
    }
    if (body.query?.includes("projects(")) {
      res.end(
        JSON.stringify({
          data: {
            projects: {
              edges: [
                {
                  node: {
                    _id: "proj123456789012345678",
                    name: "hermes-console",
                    environments: [
                      { _id: "env12345678901234567890", name: "production" },
                    ],
                    services: [
                      { _id: "svc12345678901234567890", name: "web" },
                    ],
                  },
                },
              ],
            },
          },
        }),
      );
      return;
    }
    if (body.query?.includes("variables(")) {
      res.end(JSON.stringify({ data: { variables: [{ key: "HERMES_API_KEY" }] } }));
      return;
    }
    res.end(JSON.stringify({ data: {} }));
  });
});
await new Promise<void>((resolve) => zeabur.listen(0, "127.0.0.1", resolve));
process.env.ZEABUR_API_URL =
  "http://127.0.0.1:" + (zeabur.address() as { port: number }).port;

const { runCertification } = await import("../lib/server/certification/runner");
const { put } = await import("../lib/server/store");
const certApi = await import("../app/api/certification/route");

function request(path: string, method = "GET", body?: unknown) {
  return new Request("http://localhost:3255/api/" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: process.env.CONSOLE_ORIGIN!,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function cap(
  report: Awaited<ReturnType<typeof runCertification>>,
  integration: string,
  id: string,
) {
  const group = report.integrations.find((item) => item.id === integration);
  assert.ok(group, integration);
  const found = group!.capabilities.find((item) => item.id === id);
  assert.ok(found, id);
  return found!;
}

test("capability certification does not treat discovery as whole-Hermes verified", async (t) => {
  t.after(() => {
    hermes.close();
    zeabur.close();
  });

  await t.test("truth classes keep audience as simulation", () => {
    assert.equal(audienceTruth(), "SIMULATION");
    assert.equal(classifyTruth({ simulation: true }), "SIMULATION");
    assert.equal(classifyTruth({ userProvided: true }), "USER_PROVIDED");
    assert.equal(
      classifyTruth({ retrieved: true, sourceIds: ["https://www.tku.edu.tw/"] }),
      "SOURCE_VERIFIED",
    );
    assert.equal(classifyTruth({ inferred: true }), "INFERENCE");
    assert.equal(classifyTruth({}), "UNKNOWN");
  });

  await t.test("loopback URLs are LOCAL_CONTRACT not LIVE_EXTERNAL", () => {
    assert.equal(evidenceKindForUrl("http://127.0.0.1:9"), "LOCAL_CONTRACT");
    assert.equal(evidenceKindForUrl("https://api.zeabur.com/graphql"), "LIVE_EXTERNAL");
    assert.equal(
      overallFromCapabilities(
        ["reachable", "authenticated", "verified", "configured"],
        ["reachable", "authenticated", "verified", "configured"],
      ),
      "partial",
    );
  });

  await t.test("models success certifies API/auth/models only", async () => {
    const report = await runCertification("workspace", ["hermes"]);
    const hermesReport = report.integrations.find((item) => item.id === "hermes")!;
    assert.equal(cap(report, "hermes", "hermes.api").status, "reachable");
    assert.equal(cap(report, "hermes", "hermes.auth").status, "authenticated");
    assert.equal(cap(report, "hermes", "hermes.models").status, "verified");
    assert.equal(cap(report, "hermes", "hermes.chat").status, "configured");
    assert.notEqual(cap(report, "hermes", "hermes.chat").status, "verified");
    assert.equal(cap(report, "hermes", "hermes.runs").status, "configured");
    assert.equal(cap(report, "hermes", "hermes.memory").status, "unsupported");
    assert.equal(cap(report, "hermes", "hermes.image").status, "unsupported");
    assert.equal(cap(report, "hermes", "hermes.tools").status, "partial");
    assert.equal(hermesReport.overall, "partial");
    assert.notEqual(hermesReport.overall, "verified");
    assert.equal(cap(report, "hermes", "hermes.models").evidence?.kind, "LOCAL_CONTRACT");
    assert.ok(hermesQueries.includes("/v1/models"));
    assert.ok(!hermesQueries.includes("/v1/chat/completions"));
    assert.ok(!hermesQueries.includes("/v1/runs"));
  });

  await t.test("a completed chat task verifies chat only", async () => {
    const task: Task = {
      id: randomUUID(),
      conversationId: randomUUID(),
      requestKey: randomUUID(),
      payloadHash: "fixture",
      state: "completed",
      transport: "chat",
      remoteId: null,
      input: "hello",
      attachments: [],
      output: "hi",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      error: null,
      observationError: null,
      events: [],
      usage: { ...EMPTY_USAGE, totalTokens: 12 },
      stopSupported: false,
    };
    put("task", "workspace", task);
    const report = await runCertification("workspace", ["hermes"]);
    assert.equal(cap(report, "hermes", "hermes.chat").status, "verified");
    assert.equal(cap(report, "hermes", "hermes.runs").status, "configured");
    assert.equal(cap(report, "hermes", "hermes.usage").status, "partial");
    assert.equal(report.integrations.find((item) => item.id === "hermes")!.overall, "partial");
  });

  await t.test("Zeabur read-only certification never mutates", async () => {
    process.env.ZEABUR_API_TOKEN = "zeabur-token-fixture-bbbb";
    process.env.ZEABUR_PROJECT_ID = "proj123456789012345678";
    process.env.ZEABUR_SERVICE_ID = "svc12345678901234567890";
    process.env.ZEABUR_ENVIRONMENT_ID = "env12345678901234567890";
    zeaburQueries.length = 0;
    const report = await runCertification("workspace", ["zeabur"]);
    assert.equal(cap(report, "zeabur", "zeabur.token").status, "authenticated");
    assert.equal(cap(report, "zeabur", "zeabur.identity").status, "verified");
    assert.equal(cap(report, "zeabur", "zeabur.project").status, "verified");
    assert.equal(cap(report, "zeabur", "zeabur.variables").status, "verified");
    assert.equal(cap(report, "zeabur", "zeabur.identity").evidence?.kind, "LOCAL_CONTRACT");
    assert.ok(zeaburQueries.some((query) => query.includes("me {")));
    assert.equal(zeaburQueries.filter((query) => query.includes("updateVariables")).length, 0);
    assert.equal(zeaburQueries.filter((query) => query.includes("redeployService")).length, 0);
    assert.equal(zeaburQueries.filter((query) => query.includes("restartService")).length, 0);
    assert.notEqual(report.integrations.find((item) => item.id === "zeabur")!.overall, "verified");
  });

  await t.test("research executor stays unexecuted", async () => {
    const report = await runCertification("workspace", ["research", "memory"]);
    assert.equal(cap(report, "research", "research.plan").status, "verified");
    assert.equal(cap(report, "research", "research.execute").status, "unsupported");
    assert.equal(cap(report, "research", "research.sources").status, "unknown");
    assert.equal(cap(report, "memory", "memory.local").status, "verified");
    assert.equal(cap(report, "memory", "memory.remote").status, "unknown");
    assert.match(cap(report, "memory", "memory.local").message, /synced=false/);
  });

  await t.test("certification API GET/POST", async () => {
    const listed = await certApi.GET(request("certification"));
    assert.equal(listed.status, 200);
    const ran = await certApi.POST(
      request("certification", "POST", { action: "run", integrations: ["research"] }),
    );
    assert.equal(ran.status, 200);
    const body = await ran.json();
    assert.equal(body.report.evidencePolicy.neverPromoteMockToLive, true);
    const research = body.report.integrations.find((item: { id: string }) => item.id === "research");
    assert.equal(research.overall, "partial");
  });
});
