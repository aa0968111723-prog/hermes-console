import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-phase10-sec-"));
process.env.CONSOLE_ORIGIN = "http://localhost:3240";
delete process.env.CONSOLE_USERNAME;
delete process.env.CONSOLE_PASSWORD_HASH;

const { requireWriteOrigin, validateSsrfSafeUrl } = await import("../lib/server/security.ts");
const { getAllIntegrationsReport } = await import("../lib/server/integrations/truth-status.ts");
const workspace = await import("../app/api/workspace/route.ts");
const healthRoute = await import("../app/api/health/route.ts");
const inspirationRoute = await import("../app/api/inspiration/route.ts");
const publishRoute = await import("../app/api/publish/route.ts");
const probeRoute = await import("../app/api/hermes/probe/route.ts");
const statusRoute = await import("../app/api/integrations/status/route.ts");
const simulateRoute = await import("../app/api/audience-twin/simulate/route.ts");
const personasRoute = await import("../app/api/audience-twin/personas/route.ts");

function request(path: string, method = "GET", body?: unknown, origin?: string | null) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (origin === undefined) headers.Origin = process.env.CONSOLE_ORIGIN!;
  else if (origin) headers.Origin = origin;
  return new Request("http://localhost:3240/api/" + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("Phase 10 harden no-login integration security", async (t) => {
  await t.test("GET workspace, health, personas, and inspiration work without login", async () => {
    assert.equal((await workspace.GET(request("workspace"))).status, 200);
    assert.equal((await healthRoute.GET(request("health"))).status, 200);
    assert.equal((await personasRoute.GET()).status, 200);
    assert.equal((await inspirationRoute.GET(request("inspiration"))).status, 200);
    const status = await statusRoute.GET(request("integrations/status"));
    assert.equal(status.status, 200);
  });

  await t.test("write routes reject missing or attacker origin", async () => {
    assert.equal(
      requireWriteOrigin(request("probe", "POST", {}, null) as unknown as Request).ok,
      false,
    );
    assert.equal(
      (
        await probeRoute.POST(
          request("hermes/probe", "POST", { profileId: "general" }, "https://evil.example") as never,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await simulateRoute.POST(
          request("audience-twin/simulate", "POST", { conceptTitle: "x" }, "https://evil.example") as never,
        )
      ).status,
      403,
    );
    assert.equal(
      (await publishRoute.POST(request("publish", "POST", { caption: "x", mediaId: "m", target: "t" }, null))).status,
      403,
    );
  });

  await t.test("client Hermes URL or API key is rejected on probe and status", async () => {
    const probe = await probeRoute.POST(
      request("hermes/probe", "POST", { baseUrl: "https://evil.example", apiKey: "stolen" }) as never,
    );
    assert.equal(probe.status, 400);
    const statusGet = await statusRoute.GET(
      request("integrations/status?baseUrl=https://evil.example&apiKey=stolen"),
    );
    assert.equal(statusGet.status, 400);
    const statusPost = await statusRoute.POST(
      request("integrations/status", "POST", { apiKey: "stolen", baseUrl: "http://169.254.169.254" }) as never,
    );
    assert.equal(statusPost.status, 400);
  });

  await t.test("integration report ignores client destinations and is not Connected without probe", async () => {
    const report = await getAllIntegrationsReport({
      rawUrl: "http://169.254.169.254",
      apiKey: "not-a-real-key",
    });
    assert.equal(report.integrations.length, 5);
    for (const item of report.integrations) {
      assert.notEqual(item.status, "Connected");
    }
    assert.equal(validateSsrfSafeUrl("http://169.254.169.254").safe, false);
    assert.equal(validateSsrfSafeUrl("http://0.0.0.0:80").safe, false);
  });

  await t.test("publish confirmed=true is not enough without a server token", async () => {
    const res = await publishRoute.POST(
      request("publish", "POST", {
        caption: "茶會",
        mediaId: "media",
        target: "ig",
        confirmed: true,
      }),
    );
    assert.equal(res.status, 403);
  });
});
