import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * LOCAL_CONTRACT — unconfigured workspace honesty across product lines A+B.
 * Not LIVE_EXTERNAL. Does not start Hermes, Canva, Instagram, Sheets, or Drive.
 *
 * A: creative / IG / Canva / inspiration must not look connected.
 * B: audience is simulation; publish stays blocked even with confirmed=true;
 *    locally saved activity facts are user_provided, not Drive FACT.
 */
process.env.CONSOLE_DATA_DIR = await mkdtemp(
  join(tmpdir(), "hermes-e2e-honesty-"),
);
process.env.CONSOLE_ORIGIN = "http://localhost:3261";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.CONSOLE_GATEWAY_SECRET = "";
process.env.CONSOLE_REQUIRE_GATEWAY = "false";
delete process.env.HERMES_API_URL;
delete process.env.HERMES_API_KEY;
delete process.env.CANVA_CLIENT_ID;
delete process.env.CANVA_CLIENT_SECRET;
delete process.env.INSTAGRAM_CLIENT_ID;
delete process.env.INSTAGRAM_CLIENT_SECRET;
delete process.env.PINTEREST_CLIENT_ID;
delete process.env.PINTEREST_CLIENT_SECRET;
delete process.env.MCP_BRIDGE_TOKEN;
delete process.env.ZEABUR_API_TOKEN;
delete process.env.TKU_MCP_URL;
delete process.env.TKU_MCP_TOKEN;

const integrations = await import("../app/api/integrations/route");
const publish = await import("../app/api/publish/route");
const audience = await import("../app/api/audience/route");
const inspiration = await import("../app/api/inspiration/route");
const creative = await import("../app/api/creative/route");
const certification = await import("../app/api/certification/route");
const health = await import("../app/api/health/route");
const workspace = await import("../app/api/workspace/route");

function request(path: string, method = "GET", body?: unknown) {
  return new Request("http://localhost:3261/api/" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: process.env.CONSOLE_ORIGIN!,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("unconfigured workspace never reports live integrations or auto-publish", async (t) => {
  await t.test("health and workspace stay unconfigured without Hermes keys", async () => {
    const probe = await (await health.GET(request("health"))).json();
    assert.equal(probe.credential, "missing");
    assert.notEqual(probe.status, "available");
    assert.notEqual(probe.agent, "verified");
    const space = await (await workspace.GET(request("workspace"))).json();
    assert.equal(space.memory.synced, false);
  });

  await t.test("GET /api/integrations is honest for IG / Canva / Hermes", async () => {
    const body = await (await integrations.GET(request("integrations"))).json();
    const byId = Object.fromEntries(
      (body.integrations as Array<{ id: string; state: string; detail: string }>).map(
        (item) => [item.id, item],
      ),
    );
    for (const id of ["instagram", "canva", "pinterest", "hermes", "tku"]) {
      assert.ok(byId[id], id);
      assert.notEqual(byId[id].state, "available", id + " must not look connected");
    }
    assert.equal(byId.instagram.state, "unconfigured");
    assert.equal(byId.canva.state, "unconfigured");
    assert.equal(byId.hermes.state, "unconfigured");
    assert.match(String(byId.canva.detail), /Needs Canva Authorization|尚未/);
    assert.equal(body.canva.configured, false);
    const blob = JSON.stringify(body);
    assert.doesNotMatch(blob, /"Connected"/);
    assert.doesNotMatch(blob, /LIVE_EXTERNAL/);
  });

  await t.test("Instagram publish stays disabled even with confirmed=true", async () => {
    const status = await (await publish.GET(request("publish"))).json();
    assert.equal(status.enabled, false);
    assert.equal(status.authorized, false);
    assert.equal(status.publishScope, false);
    const forged = await publish.POST(
      request("publish", "POST", {
        caption: "不應發佈",
        mediaId: "media-1",
        target: "tku_zc",
        confirmed: true,
      }),
    );
    assert.equal(forged.status, 403);
    const forgedBody = await forged.json();
    assert.equal(forgedBody.error.code, "confirmation_required");

    const prepared = await publish.POST(
      request("publish", "POST", {
        caption: "準備確認",
        mediaId: "media-1",
        target: "tku_zc",
        prepare: true,
      }),
    );
    assert.equal(prepared.status, 200);
    const token = (await prepared.json()).token;
    const confirmed = await publish.POST(
      request("publish", "POST", {
        caption: "準備確認",
        mediaId: "media-1",
        target: "tku_zc",
        token,
      }),
    );
    assert.equal(confirmed.status, 409);
    const confirmedBody = await confirmed.json();
    assert.equal(confirmedBody.error.code, "publish_blocked");
  });

  await t.test("audience twin remains simulation, not live freshman facts", async () => {
    const twin = await audience.POST(
      request("audience", "POST", { action: "twin" }),
    );
    assert.equal(twin.status, 200);
    const body = await twin.json();
    assert.equal(body.simulation, true);
    assert.equal(body.method, "rule_heuristic");
    assert.ok(body.disclaimer);
    const evaluated = await audience.POST(
      request("audience", "POST", {
        action: "evaluate",
        title: "社博手搖飲",
        copy: "來玩就好，不用先懂禪。",
      }),
    );
    assert.equal(evaluated.status, 200);
    const evalBody = await evaluated.json();
    assert.equal(evalBody.simulation, true);
  });

  await t.test("inspiration does not claim Instagram full-site search", async () => {
    const body = await (await inspiration.GET(request("inspiration"))).json();
    assert.equal(body.instagram.fullSiteSearch, false);
    assert.equal(body.instagram.authorizedApi, false);
    assert.equal(body.pinterest.fullSiteSearch, false);
    assert.ok(
      (body.providers as Array<{ id: string; state: string }>).every(
        (item) => item.id !== "instagram" || item.state !== "available",
      ),
    );
  });

  await t.test("creative activity facts stay user_provided, not Drive-confirmed", async () => {
    const created = await creative.POST(
      request("creative", "POST", {
        kind: "activity",
        input: {
          projectId: "personal",
          expectedRevision: 0,
          operationId: randomUUID(),
          title: "契約用活動（非正式）",
          facts: [
            {
              field: "name",
              value: "NEEDS_VERIFICATION 社博活動名稱",
              visibility: "public",
              sources: [],
            },
          ],
        },
      }),
    );
    assert.equal(created.status, 201);
    const activity = (await created.json()).activity;
    assert.equal(activity.facts[0].state, "user_provided");
    assert.notEqual(activity.facts[0].state, "confirmed");
  });

  await t.test("certification GET is unknown and never LIVE_EXTERNAL", async () => {
    const body = await (await certification.GET(request("certification"))).json();
    const report = body.report;
    assert.equal(report.evidencePolicy.loopbackIs, "LOCAL_CONTRACT");
    assert.equal(report.evidencePolicy.liveHttpsIs, "LIVE_EXTERNAL");
    assert.equal(report.evidencePolicy.neverPromoteMockToLive, true);
    for (const item of report.integrations) {
      assert.notEqual(item.overall, "verified");
      for (const cap of item.capabilities) {
        if (cap.evidence)
          assert.notEqual(cap.evidence.kind, "LIVE_EXTERNAL");
      }
    }
  });

  await t.test("settings UI never maps unconfigured to Connected", async () => {
    const healthUi = await readFile(
      new URL("../components/settings/IntegrationHealth.tsx", import.meta.url),
      "utf8",
    );
    assert.match(healthUi, /unconfigured:\s*"未設定"/);
    assert.match(healthUi, /available:\s*"可用"/);
    assert.doesNotMatch(healthUi, /Connected/);
    const certificationUi = await readFile(
      new URL(
        "../components/settings/CapabilityCertification.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    assert.match(certificationUi, /Connected 不是可用/);
  });
});
