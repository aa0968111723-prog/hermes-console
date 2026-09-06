import { randomBytes, createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
// Test-only session fixture, stored in each test's isolated database.
// Production has no environment flag that bypasses invitation authentication.
export function seedSession(directory = process.env.CONSOLE_DATA_DIR!, role: "admin" | "member" = "admin") {
  mkdirSync(directory, { recursive: true });
  const database = new DatabaseSync(join(directory, "console.sqlite"));
  database.exec("CREATE TABLE IF NOT EXISTS records(kind TEXT, owner TEXT, id TEXT, value TEXT, PRIMARY KEY(kind,owner,id))");
  const token = randomBytes(32).toString("hex"), id = "fixture-" + role;
  database.prepare("INSERT OR REPLACE INTO records VALUES(?,?,?,?)").run("member", "access", id, JSON.stringify({
    id, email: role + "@example.test", role, active: true, invitedAt: new Date().toISOString(), delivery: "not_sent",
  }));
  database.prepare("INSERT INTO records VALUES(?,?,?,?)").run("invite_session", "access", createHash("sha256").update(token).digest("hex"),
    JSON.stringify({ id: createHash("sha256").update(token).digest("hex"), memberId: id, expires: Date.now() + 3600000 }));
  database.close();
  return { token, cookie: "hermes_invite_session=" + token };
}
