import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { constants } from "node:fs";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-cred-"));
process.env.CONSOLE_ORIGIN = "http://localhost:3233";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.CONSOLE_GATEWAY_SECRET = "";
process.env.CONSOLE_REQUIRE_GATEWAY = "false";
process.env.HERMES_ALLOW_LOOPBACK_HTTP = "true";
process.env.HERMES_CONNECT_TIMEOUT_MS = "1000";
delete process.env.CONSOLE_VAULT_KEY;
delete process.env.HERMES_API_URL;
delete process.env.HERMES_API_KEY;
delete process.env.HERMES_MODEL;
delete process.env.MCP_BRIDGE_TOKEN;
delete process.env.TKU_MCP_URL;
delete process.env.TKU_MCP_TOKEN;
delete process.env.CONSOLE_MCP_SERVERS_JSON;

const captured: { path: string; auth?: string }[] = [];
const hermes = createServer((req, res) => {
  captured.push({
    path: req.url || "",
    auth: typeof req.headers.authorization === "string"
      ? req.headers.authorization
      : undefined,
  });
  res.setHeader("Content-Type", "application/json");
  const path = req.url || "";
  if (path.endsWith("/v1/models")) {
    res.end(JSON.stringify({ data: [{ id: "fixture-agent" }] }));
    return;
  }
  if (path.endsWith("/v1/capabilities")) {
    res.end(
      JSON.stringify({
        object: "hermes.api_server.capabilities",
        features: { run_submission: false },
      }),
    );
    return;
  }
  if (path.endsWith("/v1/skills") || path.endsWith("/v1/toolsets")) {
    res.end("[]");
    return;
  }
  res.writeHead(404).end();
});
await new Promise<void>((resolve) => hermes.listen(0, "127.0.0.1", resolve));
const hermesUrl =
  "http://127.0.0.1:" + (hermes.address() as { port: number }).port;
const hermesKey = randomBytes(24).toString("hex");

const tkuMethods: string[] = [];
const tku = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (part) => chunks.push(part));
  req.on("end", () => {
    const raw = Buffer.concat(chunks).toString("utf8");
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/auth/login") {
      const body = JSON.parse(raw || "{}") as {
        username?: string;
        password?: string;
      };
      if (body.username === "student" && body.password === "campus-secret") {
        res.end(JSON.stringify({ access_token: "tku-exchanged-token-9999" }));
        return;
      }
      res.writeHead(401).end(JSON.stringify({ error: "denied" }));
      return;
    }
    const message = JSON.parse(raw || "{}") as {
      id?: unknown;
      method?: string;
    };
    if (message.method) tkuMethods.push(message.method);
    if (message.method === "initialize") {
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            protocolVersion: "2025-06-18",
            capabilities: { tools: {} },
            serverInfo: { name: "tku-contract", version: "1" },
          },
        }),
      );
      return;
    }
    if (message.method === "notifications/initialized") {
      res.end("{}");
      return;
    }
    if (message.method === "tools/list") {
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            tools: [
              {
                name: "tku_news",
                description: "campus news",
                inputSchema: { type: "object" },
              },
            ],
          },
        }),
      );
      return;
    }
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        error: { message: "unknown method" },
      }),
    );
  });
});
await new Promise<void>((resolve) => tku.listen(0, "127.0.0.1", resolve));
const tkuUrl = "http://127.0.0.1:" + (tku.address() as { port: number }).port;
const tkuToken = "tku-static-token-abcd";

const credentials = await import("../app/api/settings/credentials/route");
const tamkangRoute = await import("../app/api/settings/tamkang/route");
const healthRoute = await import("../app/api/health/route");
const runtimeRoute = await import("../app/api/runtime/route");
const conversations = await import("../app/api/conversations/route");
const { redact } = await import("../lib/server/security");
const { vaultKeyPath } = await import("../lib/server/vault");
const { runtimeEnv } = await import("../lib/server/credentials");
const tamkang = await import("../lib/server/tamkang");

function request(
  path: string,
  method = "GET",
  body?: unknown,
  origin = process.env.CONSOLE_ORIGIN,
) {
  return new Request("http://localhost:3233/api/" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(origin ? { Origin: origin } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("workspace credential settings and Tamkang login contracts", async (t) => {
  t.after(() => {
    hermes.close();
    tku.close();
  });

  await t.test("GET credentials is open like the no-login workspace", async () => {
    const response = await credentials.GET(request("settings/credentials"));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.hermes.configured, false);
    assert.equal(body.fields.HERMES_API_KEY.configured, false);
    assert.equal(body.tamkang.state, "unconfigured");
    assert.match(body.openSettingsWarning, /沒有邀請登入或閘道保護/);
  });

  await t.test("POST still checks Origin", async () => {
    assert.equal(
      (
        await credentials.POST(
          request(
            "settings/credentials",
            "POST",
            { HERMES_API_KEY: hermesKey },
            "https://attacker.example",
          ),
        )
      ).status,
      403,
    );
  });

  await t.test("save Hermes key from UI, health uses vault, GET masks secret", async () => {
    const saved = await credentials.POST(
      request("settings/credentials", "POST", {
        HERMES_API_URL: hermesUrl,
        HERMES_API_KEY: hermesKey,
        HERMES_MODEL: "fixture-agent",
      }),
    );
    assert.equal(saved.status, 200);
    const published = await saved.json();
    assert.equal(published.hermes.configured, true);
    assert.equal(published.hermes.keySource, "vault");
    assert.equal(published.fields.HERMES_API_KEY.last4, hermesKey.slice(-4));
    assert.equal(published.fields.HERMES_API_KEY.value, undefined);
    assert.ok(!JSON.stringify(published).includes(hermesKey));
    assert.equal(published.fields.HERMES_API_URL.value, hermesUrl);
    assert.equal(runtimeEnv("HERMES_API_KEY"), hermesKey);

    const health = await healthRoute.POST(request("health", "POST", {}));
    assert.equal(health.status, 200);
    const state = await health.json();
    assert.equal(state.credential, "valid");
    assert.ok(state.models.includes("fixture-agent"));
    assert.equal(state.configSource.hermesKey, "vault");
    assert.equal(state.configSource.hermesUrl, "vault");
    assert.ok(!JSON.stringify(state).includes(hermesKey));
    assert.ok(captured.some((item) => item.auth === "Bearer " + hermesKey));

    const runtime = await runtimeRoute.GET(request("runtime"));
    assert.equal(runtime.status, 200);
    const snap = await runtime.json();
    assert.equal(snap.snapshot.diagnostics.hermesKeySource, "vault");
    assert.ok(!JSON.stringify(snap).includes(hermesKey));
  });

  await t.test("vault overrides env and redact hides stored secrets", async () => {
    process.env.HERMES_API_KEY = "env-only-key-should-not-win-zzzz";
    assert.equal(runtimeEnv("HERMES_API_KEY"), hermesKey);
    assert.equal(redact("leak " + hermesKey + " done"), "leak [redacted] done");
    delete process.env.HERMES_API_KEY;
  });

  await t.test("env remains fallback after clearing vault", async () => {
    process.env.HERMES_API_URL = hermesUrl;
    process.env.HERMES_API_KEY = hermesKey;
    const cleared = await credentials.POST(
      request("settings/credentials", "POST", {
        HERMES_API_URL: "",
        clear: ["HERMES_API_KEY"],
      }),
    );
    assert.equal(cleared.status, 200);
    const body = await cleared.json();
    assert.equal(body.hermes.configured, true);
    assert.equal(body.hermes.keySource, "env");
    assert.equal(body.hermes.urlSource, "env");
    const health = await healthRoute.POST(request("health", "POST", {}));
    assert.equal((await health.json()).configSource.hermesKey, "env");
    delete process.env.HERMES_API_URL;
    delete process.env.HERMES_API_KEY;
    await credentials.POST(
      request("settings/credentials", "POST", {
        HERMES_API_URL: hermesUrl,
        HERMES_API_KEY: hermesKey,
      }),
    );
  });

  await t.test("bootstrap vault key is persisted in the data directory", async () => {
    await access(vaultKeyPath(), constants.R_OK);
    const settings = await (
      await credentials.GET(request("settings/credentials"))
    ).json();
    assert.ok(["file", "generated"].includes(settings.vault.source));
  });

  await t.test("Tamkang save updates status; test connection can go partial", async () => {
    const saved = await credentials.POST(
      request("settings/credentials", "POST", {
        TKU_MCP_URL: tkuUrl,
        TKU_MCP_TOKEN: tkuToken,
      }),
    );
    assert.equal(saved.status, 200);
    const published = await saved.json();
    assert.notEqual(published.tamkang.state, "unconfigured");
    assert.equal(published.fields.TKU_MCP_TOKEN.last4, "abcd");
    assert.ok(!JSON.stringify(published).includes(tkuToken));
    assert.equal(tamkang.tamkangConfigured(), true);

    const probed = await tamkangRoute.POST(
      request("settings/tamkang", "POST", { action: "test" }),
    );
    assert.equal(probed.status, 200);
    const result = await probed.json();
    assert.ok(["partial", "connected", "verified", "failed"].includes(result.tamkang.state));
    assert.ok(["partial", "connected", "verified", "failed"].includes(result.probe.status));
    assert.ok(!JSON.stringify(result).includes(tkuToken));
  });

  await t.test("Tamkang campus credential exchange stores token when origin exposes /auth/login", async () => {
    await credentials.POST(
      request("settings/credentials", "POST", {
        TKU_MCP_URL: tkuUrl,
        clear: ["TKU_MCP_TOKEN"],
      }),
    );
    const exchanged = await tamkangRoute.POST(
      request("settings/tamkang", "POST", {
        action: "login",
        username: "student",
        password: "campus-secret",
      }),
    );
    assert.equal(exchanged.status, 200);
    const body = await exchanged.json();
    assert.equal(body.exchanged, true);
    assert.equal(body.fields.TKU_MCP_TOKEN.last4, "9999");
    assert.ok(!JSON.stringify(body).includes("campus-secret"));
    assert.ok(!JSON.stringify(body).includes("tku-exchanged-token-9999"));
    assert.equal(runtimeEnv("TKU_MCP_TOKEN"), "tku-exchanged-token-9999");
  });

  await t.test("unknown Tamkang auth is honest, not a fake campus SSO", async () => {
    const failed = await tamkangRoute.POST(
      request("settings/tamkang", "POST", {
        action: "login",
        username: "nobody",
        password: "wrong-password",
      }),
    );
    assert.equal(failed.status, 502);
    const body = await failed.json();
    assert.equal(body.error.code, "tku_login_unsupported");
    assert.match(body.error.message, /請改貼 Bearer 權杖/);
  });

  await t.test("research and creative conversation contracts stay intact", async () => {
    const research = await conversations.POST(
      request("conversations", "POST", {
        title: "教心所筆記",
        assistantMode: "research",
      }),
    );
    assert.equal(research.status, 201);
    const researchBody = await research.json();
    assert.equal(researchBody.conversation.assistantMode, "research");
    assert.equal(researchBody.conversation.researchBundle.executed, false);
    assert.ok(researchBody.conversation.researchBundle.queries.length > 0);

    const creative = await conversations.POST(
      request("conversations", "POST", { title: "創作草稿" }),
    );
    assert.equal(creative.status, 201);
    const creativeBody = await creative.json();
    assert.equal(creativeBody.conversation.assistantMode, "creative");
    assert.equal(creativeBody.conversation.researchBundle, undefined);
  });

  await t.test("frontend settings source does not bake secrets", async () => {
    const ui = await readFile(
      new URL("../components/settings/ConnectionSettings.tsx", import.meta.url),
      "utf8",
    );
    assert.match(ui, /settings\/credentials/);
    assert.match(ui, /settings\/tamkang/);
    assert.doesNotMatch(ui, /HERMES_API_KEY\s*=\s*["'][^"']+["']/);
    assert.doesNotMatch(ui, /sk-[a-zA-Z0-9_-]{12,}/);
    assert.doesNotMatch(ui, /tku-exchanged-token/);
    assert.doesNotMatch(ui, />帳號</);
    assert.doesNotMatch(ui, />登入</);
  });
});
