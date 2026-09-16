import test from "node:test";
import assert from "node:assert/strict";

test("startup env validation fails closed without origin or auth providers", async () => {
  const origin = process.env.CONSOLE_ORIGIN;
  const local = process.env.CONSOLE_ALLOW_LOCAL_ACCESS;
  const required = process.env.CONSOLE_AUTH_REQUIRED;
  const googleId = process.env.GOOGLE_CLIENT_ID;
  const googleSecret = process.env.GOOGLE_CLIENT_SECRET;
  const resend = process.env.RESEND_API_KEY;
  const emailFrom = process.env.CONSOLE_EMAIL_FROM;
  const testContext = process.env.NODE_TEST_CONTEXT;
  try {
    delete process.env.CONSOLE_ORIGIN;
    delete process.env.CONSOLE_ALLOW_LOCAL_ACCESS;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.RESEND_API_KEY;
    delete process.env.CONSOLE_EMAIL_FROM;
    process.env.CONSOLE_AUTH_REQUIRED = "true";
    const { validateRuntimeEnv } = await import("../lib/server/env");
    assert.throws(() => validateRuntimeEnv(), /CONSOLE_ORIGIN/);
    process.env.CONSOLE_ORIGIN = "https://hermes.example";
    process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
    assert.doesNotThrow(() => validateRuntimeEnv());
    process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "false";
    assert.throws(() => validateRuntimeEnv(), /Google OAuth|Email 寄信/);
  } finally {
    restore("CONSOLE_ORIGIN", origin);
    restore("CONSOLE_ALLOW_LOCAL_ACCESS", local);
    restore("CONSOLE_AUTH_REQUIRED", required);
    restore("GOOGLE_CLIENT_ID", googleId);
    restore("GOOGLE_CLIENT_SECRET", googleSecret);
    restore("RESEND_API_KEY", resend);
    restore("CONSOLE_EMAIL_FROM", emailFrom);
    restore("NODE_TEST_CONTEXT", testContext);
  }
});

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
