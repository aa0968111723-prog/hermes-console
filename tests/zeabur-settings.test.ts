import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-zeabur-"));
process.env.CONSOLE_ORIGIN = "http://localhost:3241";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.CONSOLE_GATEWAY_SECRET = "";
process.env.HERMES_ALLOW_LOOPBACK_HTTP = "true";
delete process.env.ZEABUR_API_TOKEN;

const captured: { query?: string; auth?: string }[] = [];
const zeabur = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (part) => chunks.push(part));
  req.on("end", () => {
    const raw = Buffer.concat(chunks).toString("utf8");
    let body: { query?: string; variables?: { data?: Array<{ key: string }> } } =
      {};
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      body = {};
    }
    captured.push({
      query: body.query,
      auth: typeof req.headers.authorization === "string"
        ? req.headers.authorization
        : undefined,
    });
    res.setHeader("Content-Type", "application/json");
    if ((req.headers.authorization || "").includes("bad-token")) {
      res.writeHead(401).end(JSON.stringify({ errors: [{ message: "nope" }] }));
      return;
    }
    if (body.query?.includes("me {")) {
      res.end(JSON.stringify({ data: { me: { username: "owner" } } }));
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
    if (body.query?.includes("updateVariables")) {
      res.end(
        JSON.stringify({
          data: {
            updateVariables: (body.variables?.data || []).map((item) => ({
              key: item.key,
            })),
          },
        }),
      );
      return;
    }
    if (body.query?.includes("redeployService")) {
      res.end(
        JSON.stringify({
          data: {
            redeployService: { _id: "dep12345678901234567890", status: "BUILDING" },
          },
        }),
      );
      return;
    }
    if (body.query?.includes("restartService")) {
      res.end(JSON.stringify({ data: { restartService: true } }));
      return;
    }
    res.end(JSON.stringify({ data: {} }));
  });
});
await new Promise<void>((resolve) => zeabur.listen(0, "127.0.0.1", resolve));
process.env.ZEABUR_API_URL =
  "http://127.0.0.1:" + (zeabur.address() as { port: number }).port;

const credentials = await import("../app/api/settings/credentials/route");
const zeaburRoute = await import("../app/api/settings/zeabur/route");

function request(path: string, method = "GET", body?: unknown) {
  return new Request("http://localhost:3241/api/" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: process.env.CONSOLE_ORIGIN!,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("Zeabur settings vault and mocked GraphQL operations", async (t) => {
  t.after(() => zeabur.close());

  await t.test("token is saved masked and used for test/list", async () => {
    const token = "zeabur-token-fixture-aaaa";
    const saved = await credentials.POST(
      request("settings/credentials", "POST", {
        ZEABUR_API_TOKEN: token,
        ZEABUR_PROJECT_ID: "proj123456789012345678",
        ZEABUR_SERVICE_ID: "svc12345678901234567890",
        ZEABUR_ENVIRONMENT_ID: "env12345678901234567890",
      }),
    );
    assert.equal(saved.status, 200);
    const published = await saved.json();
    assert.equal(published.fields.ZEABUR_API_TOKEN.last4, "aaaa");
    assert.ok(!JSON.stringify(published).includes(token));
    assert.match(published.zeabur.notice, /覆寫權杖/);

    const tested = await zeaburRoute.POST(
      request("settings/zeabur", "POST", { action: "test" }),
    );
    assert.equal(tested.status, 200);
    const identity = await tested.json();
    assert.equal(identity.ok, true);
    assert.ok(!JSON.stringify(identity).includes(token));
    assert.ok(captured.some((item) => item.auth === "Bearer " + token));

    const listed = await zeaburRoute.POST(
      request("settings/zeabur", "POST", { action: "list" }),
    );
    assert.equal(listed.status, 200);
    assert.equal((await listed.json()).projects[0].name, "hermes-console");
  });

  await t.test("push console keys and redeploy without echoing secrets", async () => {
    await credentials.POST(
      request("settings/credentials", "POST", {
        HERMES_API_KEY: "hermes-from-console-zzzz",
        HERMES_API_URL: "https://hermes.example.invalid",
      }),
    );
    const prepared = await zeaburRoute.POST(
      request("settings/zeabur", "POST", { action: "push_console_keys" }),
    );
    assert.equal(prepared.status, 200);
    const prep = await prepared.json();
    assert.equal(prep.needsConfirmation, true);
    assert.equal(typeof prep.token, "string");

    const pushed = await zeaburRoute.POST(
      request("settings/zeabur", "POST", {
        action: "push_console_keys",
        confirmationToken: prep.token,
      }),
    );
    assert.equal(pushed.status, 200);
    const body = await pushed.json();
    assert.ok(body.updated.includes("HERMES_API_KEY"));
    assert.ok(!JSON.stringify(body).includes("hermes-from-console-zzzz"));

    async function confirm(actionBody: Record<string, unknown>) {
      const first = await zeaburRoute.POST(
        request("settings/zeabur", "POST", actionBody),
      );
      const minted = await first.json();
      assert.equal(minted.needsConfirmation, true);
      return zeaburRoute.POST(
        request("settings/zeabur", "POST", {
          ...actionBody,
          confirmationToken: minted.token,
        }),
      );
    }

    const edited = await confirm({
      action: "update_env",
      variables: [{ key: "HERMES_MODEL", value: "fixture-agent" }],
    });
    assert.equal(edited.status, 200);

    const redeployed = await confirm({ action: "redeploy" });
    assert.equal(redeployed.status, 200);
    assert.equal((await redeployed.json()).status, "BUILDING");

    const restarted = await confirm({ action: "restart" });
    assert.equal(restarted.status, 200);
    assert.equal((await restarted.json()).ok, true);
  });
});
