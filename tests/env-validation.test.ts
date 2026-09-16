import test from "node:test";
import assert from "node:assert/strict";
import { validateRuntimeEnv } from "../lib/server/env";

function withEnv(patch: Record<string, string | undefined>, run: () => void) {
  const keys = Object.keys(patch);
  const previous = Object.fromEntries(
    keys.map((key) => [key, process.env[key]]),
  );
  try {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("production startup rejects test session bypass and public http origins", () => {
  withEnv(
    {
      NODE_ENV: "production",
      NODE_TEST_CONTEXT: "1",
      CONSOLE_TEST_SESSION: "fixture",
      CONSOLE_ORIGIN: "https://console.example",
      CONSOLE_ALLOW_LOCAL_ACCESS: undefined,
    },
    () => {
      assert.throws(validateRuntimeEnv, /測試用 session/);
    },
  );
  withEnv(
    {
      NODE_ENV: "production",
      NODE_TEST_CONTEXT: undefined,
      CONSOLE_TEST_SESSION: undefined,
      CONSOLE_ORIGIN: "http://console.example",
      CONSOLE_ALLOW_LOCAL_ACCESS: undefined,
    },
    () => {
      assert.throws(validateRuntimeEnv, /必須是 HTTPS/);
    },
  );
  withEnv(
    {
      NODE_ENV: "production",
      NODE_TEST_CONTEXT: undefined,
      CONSOLE_TEST_SESSION: undefined,
      CONSOLE_ORIGIN: "https://console.example",
      CONSOLE_ALLOW_LOCAL_ACCESS: "true",
    },
    () => {
      assert.throws(validateRuntimeEnv, /只能用於本機/);
    },
  );
  withEnv(
    {
      NODE_ENV: "production",
      NODE_TEST_CONTEXT: undefined,
      CONSOLE_TEST_SESSION: undefined,
      CONSOLE_ORIGIN: "http://127.0.0.1:3220",
      CONSOLE_ALLOW_LOCAL_ACCESS: "true",
    },
    () => {
      assert.doesNotThrow(validateRuntimeEnv);
    },
  );
  withEnv(
    {
      NODE_ENV: "production",
      NODE_TEST_CONTEXT: undefined,
      CONSOLE_TEST_SESSION: undefined,
      CONSOLE_ORIGIN: undefined,
      CONSOLE_ALLOW_LOCAL_ACCESS: undefined,
    },
    () => {
      assert.throws(validateRuntimeEnv, /缺少 CONSOLE_ORIGIN/);
    },
  );
});
