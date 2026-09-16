import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  applySessionFetch,
  EMPTY_SESSION_VIEW,
  failClosedSession,
} from "../lib/client/auth-session";

test("session errors fail closed and never open the workspace", () => {
  const crashed = applySessionFetch(EMPTY_SESSION_VIEW, {
    ok: false,
    data: {
      error: { category: "UNKNOWN", message: "internal_error" },
    },
  });
  assert.equal(crashed.loading, false);
  assert.equal(crashed.unreachable, true);
  assert.equal(crashed.required, true);
  assert.equal(crashed.mode, "required");
  assert.equal(crashed.user, null);

  const malformed = applySessionFetch(
    { ...EMPTY_SESSION_VIEW, loading: false, required: false, mode: "workspace" },
    { ok: true, data: { required: false, user: null } },
  );
  assert.equal(malformed.unreachable, true);
  assert.equal(malformed.required, true);
  assert.equal(malformed.user, null);

  const signedIn = failClosedSession({
    ...EMPTY_SESSION_VIEW,
    loading: false,
    required: true,
    user: {
      id: "user-1",
      email: "owner@example.test",
      emailVerified: true,
      name: "Owner",
      avatar: null,
    },
    membership: { role: "owner", workspaceId: "workspace" },
  });
  assert.equal(signedIn.unreachable, true);
  assert.equal(signedIn.user?.id, "user-1");
  assert.equal(signedIn.required, true);
});

test("usable session payloads still distinguish login vs workspace mode", () => {
  const login = applySessionFetch(EMPTY_SESSION_VIEW, {
    ok: true,
    data: { mode: "required", required: true, user: null, google: "unconfigured" },
  });
  assert.equal(login.unreachable, false);
  assert.equal(login.required, true);
  assert.equal(login.user, null);

  const local = applySessionFetch(EMPTY_SESSION_VIEW, {
    ok: true,
    data: { mode: "workspace", required: false, user: null },
  });
  assert.equal(local.unreachable, false);
  assert.equal(local.required, false);
  assert.equal(local.mode, "workspace");
  assert.equal(local.user, null);
});

test("AuthGate keeps HermesConsole unloaded while the session is unreachable", async () => {
  const gate = await readFile(
    new URL("../components/auth/AuthGate.tsx", import.meta.url),
    "utf8",
  );
  const provider = await readFile(
    new URL("../components/auth/AuthProvider.tsx", import.meta.url),
    "utf8",
  );
  assert.match(gate, /auth\.unreachable && !auth\.user/);
  assert.match(gate, /離線/);
  assert.match(gate, /再試一次/);
  assert.ok(
    gate.indexOf("unreachable") < gate.indexOf("HermesConsole />"),
    "unreachable gate must run before loading HermesConsole",
  );
  assert.match(provider, /applySessionFetch/);
  assert.match(provider, /failClosedSession/);
  assert.doesNotMatch(provider, /required: false,\s*mode: "workspace"/);
});
