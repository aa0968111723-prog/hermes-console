import { randomBytes, createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

/** Isolated test identity + workspace membership. Production has no bypass. */
export function seedSession(
  directory = process.env.CONSOLE_DATA_DIR!,
  role: "owner" | "admin" | "member" = "owner",
) {
  mkdirSync(directory, { recursive: true });
  const database = new DatabaseSync(join(directory, "console.sqlite"));
  database.exec(
    "CREATE TABLE IF NOT EXISTS records(kind TEXT, owner TEXT, id TEXT, value TEXT, PRIMARY KEY(kind,owner,id))",
  );
  const token = randomBytes(32).toString("hex");
  const userId = "fixture-" + role;
  const email = role + "@example.test";
  const now = new Date().toISOString();
  const insert = database.prepare("INSERT OR REPLACE INTO records VALUES(?,?,?,?)");
  insert.run(
    "user",
    "identity",
    userId,
    JSON.stringify({
      id: userId,
      name: "測試 " + role,
      email,
      avatarUrl: null,
      passwordHash: null,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    }),
  );
  insert.run(
    "identity",
    "identity",
    digest("email:" + email),
    JSON.stringify({
      id: digest("email:" + email),
      userId,
      provider: "email",
      providerId: email,
      email,
      emailVerified: true,
      createdAt: now,
    }),
  );
  insert.run(
    "membership",
    "workspace",
    userId,
    JSON.stringify({
      id: userId,
      userId,
      workspaceId: "workspace",
      role: role === "member" ? "member" : role,
      createdAt: now,
    }),
  );
  insert.run(
    "auth_session",
    "identity",
    digest(token),
    JSON.stringify({
      id: digest(token),
      userId,
      expires: Date.now() + 3600000,
      createdAt: now,
    }),
  );
  database.close();
  if (process.env.NODE_TEST_CONTEXT) process.env.CONSOLE_TEST_SESSION = token;
  return { token, cookie: "hermes_session=" + token, userId };
}

export function seedInviteSession(
  directory = process.env.CONSOLE_DATA_DIR!,
  role: "admin" | "member" = "admin",
) {
  mkdirSync(directory, { recursive: true });
  const database = new DatabaseSync(join(directory, "console.sqlite"));
  database.exec(
    "CREATE TABLE IF NOT EXISTS records(kind TEXT, owner TEXT, id TEXT, value TEXT, PRIMARY KEY(kind,owner,id))",
  );
  const token = randomBytes(32).toString("hex"),
    id = "fixture-invite-" + role;
  database
    .prepare("INSERT OR REPLACE INTO records VALUES(?,?,?,?)")
    .run(
      "member",
      "access",
      id,
      JSON.stringify({
        id,
        email: role + "@example.test",
        role,
        active: true,
        invitedAt: new Date().toISOString(),
        delivery: "not_sent",
      }),
    );
  database
    .prepare("INSERT INTO records VALUES(?,?,?,?)")
    .run(
      "invite_session",
      "access",
      createHash("sha256").update(token).digest("hex"),
      JSON.stringify({
        id: createHash("sha256").update(token).digest("hex"),
        memberId: id,
        expires: Date.now() + 3600000,
      }),
    );
  database.close();
  return { token, cookie: "hermes_invite_session=" + token };
}
