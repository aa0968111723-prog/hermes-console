import test from "node:test";
import assert from "node:assert/strict";
import { validateRuntimeEnv } from "../lib/server/env";

function withEnv(values: Record<string, string | undefined>, run: () => void) {
  const previous = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(values)) {
    previous.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    run();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test("production startup fails on missing origin, public HTTP, and weak gateway", () => {
  withEnv({ NODE_ENV: "development", CONSOLE_ORIGIN: "" }, () => {
    validateRuntimeEnv();
  });
  withEnv({ NODE_ENV: "production", NEXT_PHASE: "phase-production-build", CONSOLE_ORIGIN: "" }, () => {
    validateRuntimeEnv();
  });
  withEnv({ NODE_ENV: "production", NEXT_PHASE: undefined, CONSOLE_ORIGIN: "" }, () => {
    assert.throws(() => validateRuntimeEnv(), /CONSOLE_ORIGIN/);
  });
  withEnv({
    NODE_ENV: "production",
    NEXT_PHASE: undefined,
    CONSOLE_ORIGIN: "http://example.com",
    CONSOLE_ALLOW_LOCAL_ACCESS: "false",
    CONSOLE_REQUIRE_GATEWAY: "false",
  }, () => {
    assert.throws(() => validateRuntimeEnv(), /HTTPS/);
  });
  withEnv({
    NODE_ENV: "production",
    NEXT_PHASE: undefined,
    CONSOLE_ORIGIN: "https://console.example",
    CONSOLE_ALLOW_LOCAL_ACCESS: "true",
    CONSOLE_REQUIRE_GATEWAY: "false",
  }, () => {
    assert.throws(() => validateRuntimeEnv(), /loopback/);
  });
  withEnv({
    NODE_ENV: "production",
    NEXT_PHASE: undefined,
    CONSOLE_ORIGIN: "https://console.example",
    CONSOLE_ALLOW_LOCAL_ACCESS: "false",
    CONSOLE_REQUIRE_GATEWAY: "true",
    CONSOLE_GATEWAY_SECRET: "too-short",
  }, () => {
    assert.throws(() => validateRuntimeEnv(), /32/);
  });
  withEnv({
    NODE_ENV: "production",
    NEXT_PHASE: undefined,
    CONSOLE_ORIGIN: "http://127.0.0.1:3215",
    CONSOLE_ALLOW_LOCAL_ACCESS: "true",
    CONSOLE_REQUIRE_GATEWAY: "false",
    CONSOLE_GATEWAY_SECRET: "",
  }, () => {
    validateRuntimeEnv();
  });
});
