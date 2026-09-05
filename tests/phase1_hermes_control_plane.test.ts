import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  createConversation,
  conversationBelongsToSession,
  getAgentProfile,
  getOrCreateSessionContext,
  getSessionContext,
  listConversationsForSession,
  listHermesNamedProfiles,
  normalizeSessionKey,
  probeHermesCapabilities,
  resolveHermesTarget,
  updateSessionMetadata,
} from "../lib/server/hermes/index.ts";
import { sessionKeyFor } from "../lib/server/hermes.ts";

test("Phase 1 Hermes control plane and profile sessions", async (t) => {
  await t.test("console role is not a live Hermes /p/<profile>", () => {
    const profile = getAgentProfile("tku");
    assert.equal(profile.kind, "console_role");
    assert.equal(profile.hermesProfilePath, null);
    const missing = getAgentProfile("does-not-exist");
    assert.equal(missing.id, "general");
    assert.equal(missing.kind, "console_role");
  });

  await t.test("default Hermes remains configured when named profiles are absent", () => {
    const previousUrl = process.env.HERMES_API_URL;
    const previousKey = process.env.HERMES_API_KEY;
    process.env.HERMES_API_URL = "https://hermes.example.invalid";
    process.env.HERMES_API_KEY = "fixture-default-key";
    delete process.env.HERMES_CREATIVE_API_URL;
    delete process.env.HERMES_CREATIVE_API_KEY;
    try {
      const resolved = resolveHermesTarget("general");
      assert.equal(resolved.ok, true);
      assert.equal(resolved.fallbackUsed, false);
      assert.equal(resolved.credentialReference, "HERMES_API_KEY");
      const namedMissing = resolveHermesTarget("ghost-profile");
      assert.equal(namedMissing.configured, false);
      assert.ok(namedMissing.error);
      assert.equal(namedMissing.ok, true);
      assert.equal(namedMissing.fallbackUsed, true);
      const json = JSON.stringify({ resolved, namedMissing, profiles: listHermesNamedProfiles() });
      assert.ok(!json.includes("fixture-default-key"));
    } finally {
      if (previousUrl === undefined) delete process.env.HERMES_API_URL;
      else process.env.HERMES_API_URL = previousUrl;
      if (previousKey === undefined) delete process.env.HERMES_API_KEY;
      else process.env.HERMES_API_KEY = previousKey;
    }
  });

  await t.test("named profile uses /p/<profile> and its own credential reference", () => {
    const previousUrl = process.env.HERMES_CREATIVE_API_URL;
    const previousKey = process.env.HERMES_CREATIVE_API_KEY;
    process.env.HERMES_CREATIVE_API_URL = "https://hermes.example.invalid/p/creative";
    process.env.HERMES_CREATIVE_API_KEY = "fixture-creative-key";
    try {
      const resolved = resolveHermesTarget("creative");
      assert.equal(resolved.ok, true);
      assert.equal(resolved.kind, "console_role");
      assert.equal(resolved.profilePath, "/p/creative");
      assert.equal(resolved.credentialReference, "HERMES_CREATIVE_API_KEY");
      assert.equal(resolved.fallbackUsed, false);
      const listed = listHermesNamedProfiles();
      const creative = listed.find((item) => item.id === "creative");
      assert.equal(creative?.credentialReference, "HERMES_CREATIVE_API_KEY");
      assert.ok(!JSON.stringify(listed).includes("fixture-creative-key"));
    } finally {
      if (previousUrl === undefined) delete process.env.HERMES_CREATIVE_API_URL;
      else process.env.HERMES_CREATIVE_API_URL = previousUrl;
      if (previousKey === undefined) delete process.env.HERMES_CREATIVE_API_KEY;
      else process.env.HERMES_CREATIVE_API_KEY = previousKey;
    }
  });

  await t.test("session keys isolate projects and keep conversation ids separate", () => {
    assert.equal(normalizeSessionKey("project:tku-zen"), "project:tku-zen");
    assert.equal(normalizeSessionKey("campaign:recruitment"), "campaign:recruitment");
    assert.equal(normalizeSessionKey("audience:tku-freshman"), "audience:tku-freshman");
    assert.equal(sessionKeyFor(undefined, undefined, "tku-freshman"), "audience:tku-freshman");

    const projectA = getOrCreateSessionContext("project:alpha", { activeProject: "project-a" });
    const projectB = getOrCreateSessionContext("project:beta", { activeProject: "project-b" });
    assert.notEqual(projectA.sessionKey, projectB.sessionKey);
    updateSessionMetadata("project:alpha", "note", "only-a");
    assert.equal(getSessionContext("project:alpha")?.metadata.note, "only-a");
    assert.equal(getSessionContext("project:beta")?.metadata.note, undefined);

    const first = createConversation("project:alpha");
    const second = createConversation("project:alpha");
    assert.equal(first.sessionKey, "project:alpha");
    assert.equal(second.sessionKey, "project:alpha");
    assert.notEqual(first.id, second.id);
    assert.equal(conversationBelongsToSession(first.id, "project:alpha"), true);
    assert.equal(conversationBelongsToSession(first.id, "project:beta"), false);
    assert.ok(listConversationsForSession("project:alpha").length >= 2);
    assert.equal(
      listConversationsForSession("project:beta").some((item) => item.id === first.id),
      false,
    );
  });

  await t.test("feature detection marks 404 endpoints unsupported, not online", async () => {
    const server = http.createServer((req, res) => {
      if (req.url === "/health" || req.url === "/v1/models") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          req.url === "/v1/models"
            ? JSON.stringify({ data: [{ id: "fixture-agent" }] })
            : JSON.stringify({ status: "ok" }),
        );
        return;
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not Found" }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const port = (server.address() as { port: number }).port;
    try {
      const report = await probeHermesCapabilities(`http://127.0.0.1:${port}`, "fixture-key");
      assert.equal(report.online, true);
      assert.equal(report.features.models, "available");
      assert.equal(report.features.health, "available");
      assert.equal(report.features.skills, "unsupported");
      assert.equal(report.features.toolsets, "unsupported");
      assert.equal(report.features.runs, "unsupported");
      assert.equal(report.features.sessions, "unsupported");
      assert.ok(report.models.includes("fixture-agent"));
    } finally {
      server.close();
    }
  });
});
