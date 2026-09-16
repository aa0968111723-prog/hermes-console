import { seedTestOwner } from "../lib/server/identity";

// Test-only identity session. Production has no env flag that bypasses login.
export function seedSession(
  _directory = process.env.CONSOLE_DATA_DIR!,
  _role: "admin" | "member" | "owner" = "owner",
) {
  const seeded = seedTestOwner({
    email: _role + "@example.test",
    name: "Fixture " + _role,
  });
  return { token: seeded.token, cookie: seeded.cookie, user: seeded.user };
}
