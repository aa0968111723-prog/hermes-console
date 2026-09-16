import test from "node:test";
import assert from "node:assert/strict";
import { validateProductionEnv } from "../lib/server/env";

test("production startup rejects workspace auth and missing origin", () => {
  const env = process.env as Record<string, string | undefined>;
  const previous = {
    NODE_ENV: env.NODE_ENV,
    NEXT_PHASE: env.NEXT_PHASE,
    CONSOLE_ORIGIN: env.CONSOLE_ORIGIN,
    CONSOLE_AUTH_MODE: env.CONSOLE_AUTH_MODE,
  };
  try {
    env.NODE_ENV = "production";
    delete env.NEXT_PHASE;
    delete env.CONSOLE_ORIGIN;
    delete env.CONSOLE_AUTH_MODE;
    assert.throws(() => validateProductionEnv(), /CONSOLE_ORIGIN is required/);
    env.CONSOLE_ORIGIN = "not-a-url";
    assert.throws(() => validateProductionEnv(), /absolute URL/);
    env.CONSOLE_ORIGIN = "http://public.example";
    assert.throws(() => validateProductionEnv(), /must be https/);
    env.CONSOLE_ORIGIN = "http://127.0.0.1";
    assert.doesNotThrow(() => validateProductionEnv());
    env.CONSOLE_ORIGIN = "https://hermes.example.test";
    env.CONSOLE_AUTH_MODE = "workspace";
    assert.throws(
      () => validateProductionEnv(),
      /workspace is not allowed in production/,
    );
    delete env.CONSOLE_AUTH_MODE;
    assert.doesNotThrow(() => validateProductionEnv());
    env.NODE_ENV = "test";
    env.CONSOLE_AUTH_MODE = "workspace";
    assert.doesNotThrow(() => validateProductionEnv());
  } finally {
    if (previous.NODE_ENV == null) delete env.NODE_ENV;
    else env.NODE_ENV = previous.NODE_ENV;
    if (previous.NEXT_PHASE == null) delete env.NEXT_PHASE;
    else env.NEXT_PHASE = previous.NEXT_PHASE;
    if (previous.CONSOLE_ORIGIN == null) delete env.CONSOLE_ORIGIN;
    else env.CONSOLE_ORIGIN = previous.CONSOLE_ORIGIN;
    if (previous.CONSOLE_AUTH_MODE == null) delete env.CONSOLE_AUTH_MODE;
    else env.CONSOLE_AUTH_MODE = previous.CONSOLE_AUTH_MODE;
  }
});
