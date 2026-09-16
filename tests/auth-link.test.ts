import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-auth-link-"));
process.env.CONSOLE_ORIGIN = "http://localhost:3313";
process.env.CONSOLE_AUTH_MODE = "required";

const {
  createUser,
  findIdentity,
  linkIdentity,
} = await import("../lib/server/auth/identity");
const { registerEmail } = await import("../lib/server/auth/providers/email");

test("identities never auto-merge on email match", async () => {
  const emailUser = await registerEmail(
    "same@example.test",
    "correct-horse-battery",
  );
  const googleUser = createUser({
    email: "same@example.test",
    emailVerified: true,
    name: "Google",
  });
  linkIdentity(googleUser.id, {
    provider: "google",
    subject: "google-sub-1",
    email: "same@example.test",
    emailVerified: true,
  });
  const emailIdentity = findIdentity("email", "same@example.test");
  const googleIdentity = findIdentity("google", "google-sub-1");
  assert.ok(emailIdentity);
  assert.ok(googleIdentity);
  assert.notEqual(emailIdentity!.userId, googleIdentity!.userId);
  assert.throws(
    () =>
      linkIdentity(emailIdentity!.userId, {
        provider: "google",
        subject: "google-sub-1",
        email: "same@example.test",
        emailVerified: true,
      }),
    /不會因電子信箱相同而自動合併|已連結其他/,
  );
  void emailUser;
});
