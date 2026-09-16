import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-tamkang-sso-"));
process.env.CONSOLE_ORIGIN = "http://localhost:3242";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.CONSOLE_GATEWAY_SECRET = "";
process.env.HERMES_ALLOW_LOOPBACK_HTTP = "true";
process.env.GOOGLE_CLIENT_ID = "google-contract-client";
process.env.GOOGLE_CLIENT_SECRET = randomBytes(24).toString("hex");
process.env.TAMKANG_SSO_CLIENT_ID = "tku-oidc-client";
process.env.TAMKANG_SSO_CLIENT_SECRET = randomBytes(24).toString("hex");
process.env.TAMKANG_SSO_PROTOCOL = "oidc";

type OidcMode = "ok" | "discovery_failed" | "incomplete";
type Profile = { sub: string; email: string; name: string };

function createMockOidc() {
  const seen = { discovery: 0, token: 0, userinfo: 0 };
  const profiles = new Map<string, Profile>([
    [
      "fixture-code",
      {
        sub: "tku-oidc-1",
        email: "tku.user@example.test",
        name: "TKU User",
      },
    ],
    [
      "link-code",
      {
        sub: "tku-oidc-link",
        email: "tku.link@example.test",
        name: "TKU Linked",
      },
    ],
    [
      "other-code",
      {
        sub: "tku-oidc-2",
        email: "shared@example.test",
        name: "Other TKU",
      },
    ],
  ]);
  const state = { mode: "ok" as OidcMode };
  const server = createServer(async (req, res) => {
    const host = req.headers.host || "127.0.0.1";
    const url = new URL(req.url || "/", `http://${host}`);
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === "/.well-known/openid-configuration") {
      seen.discovery += 1;
      if (state.mode === "discovery_failed") {
        json(503, { error: "unavailable" });
        return;
      }
      if (state.mode === "incomplete") {
        json(200, { issuer: `http://${host}` });
        return;
      }
      const issuer = `http://${host}`;
      json(200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        userinfo_endpoint: `${issuer}/userinfo`,
      });
      return;
    }
    if (url.pathname === "/token" && req.method === "POST") {
      seen.token += 1;
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
      if (
        body.get("grant_type") !== "authorization_code" ||
        body.get("client_id") !== process.env.TAMKANG_SSO_CLIENT_ID ||
        body.get("client_secret") !== process.env.TAMKANG_SSO_CLIENT_SECRET ||
        !body.get("code_verifier")
      ) {
        json(401, { error: "invalid_client" });
        return;
      }
      const profile = profiles.get(body.get("code") || "");
      if (!profile) {
        json(401, { error: "invalid_grant" });
        return;
      }
      json(200, {
        access_token: "tku-access-" + body.get("code"),
        token_type: "Bearer",
      });
      return;
    }
    if (url.pathname === "/userinfo") {
      seen.userinfo += 1;
      const auth = String(req.headers.authorization || "");
      const code = auth.replace(/^Bearer tku-access-/, "");
      const profile = profiles.get(code);
      if (!profile) {
        json(401, { error: "invalid_token" });
        return;
      }
      json(200, {
        sub: profile.sub,
        email: profile.email,
        email_verified: true,
        name: profile.name,
      });
      return;
    }
    json(404, { error: "not_found" });
  });
  return { server, seen, state };
}

const oidc = createMockOidc();
await new Promise<void>((resolve) => {
  oidc.server.listen(0, "127.0.0.1", () => resolve());
});
const port = (oidc.server.address() as AddressInfo).port;
process.env.TAMKANG_SSO_ISSUER = `http://127.0.0.1:${port}`;

after(
  () =>
    new Promise<void>((resolve, reject) => {
      oidc.server.close((error) => (error ? reject(error) : resolve()));
    }),
);

const { startTamkang, finishTamkang } = await import("../lib/server/auth/tamkang");
const { startGoogle, finishGoogle } = await import("../lib/server/auth/google");
const { identitiesFor, getUser, findUserByEmail } = await import(
  "../lib/server/auth/identity"
);
const { loginEmail } = await import("../lib/server/auth/email");
const emailRoute = await import("../app/api/auth/email/route");

function cookieHeader(token: string) {
  return "hermes_auth=" + token;
}

function emailRequest(body: unknown, cookie = "") {
  return new Request("http://localhost:3242/api/auth/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:3242",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function withGoogleFetch<T>(run: () => Promise<T>) {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const href = String(input);
    if (href.includes("oauth2.googleapis.com/token")) {
      const body = String(init?.body || "");
      assert.match(body, /grant_type=authorization_code/);
      assert.match(body, /code_verifier=/);
      return Response.json({ access_token: "ya29.fixture-access" });
    }
    if (href.includes("openidconnect.googleapis.com")) {
      return Response.json({
        sub: "google-sub-link-1",
        email: "google.user@example.test",
        email_verified: true,
        name: "Google User",
        picture: "https://example.test/avatar.png",
      });
    }
    return original(input, init);
  };
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

test("Tamkang authorization code + PKCE uses discovery and keeps secrets off the redirect", async () => {
  const url = new URL(await startTamkang("login"));
  assert.equal(url.origin, process.env.TAMKANG_SSO_ISSUER);
  assert.equal(url.pathname, "/authorize");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.ok(url.searchParams.get("code_challenge"));
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("client_secret"), null);
  assert.doesNotMatch(
    url.toString(),
    new RegExp(process.env.TAMKANG_SSO_CLIENT_SECRET || "missing"),
  );
  assert.ok(oidc.seen.discovery >= 1);
});

test("SAML and CAS stay unconfigured and do not hit the IdP", async () => {
  const before = oidc.seen.discovery;
  for (const protocol of ["saml", "cas"] as const) {
    process.env.TAMKANG_SSO_PROTOCOL = protocol;
    await assert.rejects(
      () => startTamkang("login"),
      /尚未完成設定/,
    );
  }
  process.env.TAMKANG_SSO_PROTOCOL = "oidc";
  assert.equal(oidc.seen.discovery, before);
});

test("failed or incomplete discovery does not pretend Tamkang SSO works", async () => {
  oidc.state.mode = "discovery_failed";
  await assert.rejects(() => startTamkang("login"), /尚未完成設定/);
  oidc.state.mode = "incomplete";
  await assert.rejects(() => startTamkang("login"), /尚未完成設定/);
  oidc.state.mode = "ok";
});

test("mocked Tamkang token exchange issues a session for one user", async () => {
  const start = new URL(await startTamkang("login"));
  const state = start.searchParams.get("state") || "";
  const result = await finishTamkang(
    new Request(
      "http://localhost:3242/api/auth/tamkang/callback?code=fixture-code&state=" +
        state,
    ),
  );
  assert.ok(result.token);
  assert.match(result.token || "", /^[a-f0-9]{64}$/);
  const user = getUser(result.userId);
  assert.equal(user?.email, "tku.user@example.test");
  assert.ok(identitiesFor(result.userId).some((item) => item.provider === "tamkang"));
});

test("invalid Tamkang state does not pretend success", async () => {
  await assert.rejects(
    () =>
      finishTamkang(
        new Request(
          "http://localhost:3242/api/auth/tamkang/callback?code=fixture-code&state=deadbeef",
        ),
      ),
    /過期|未完成/,
  );
});

test("Google then Tamkang then Email stay one user after Tamkang returns", async () => {
  const google = await withGoogleFetch(async () => {
    const start = new URL(startGoogle("login"));
    return finishGoogle(
      new Request(
        "http://localhost:3242/api/auth/google/callback?code=fixture-code&state=" +
          (start.searchParams.get("state") || ""),
      ),
    );
  });
  assert.ok(google.token);
  const userId = google.userId;

  const linkStart = new URL(await startTamkang("link", userId));
  const linked = await finishTamkang(
    new Request(
      "http://localhost:3242/api/auth/tamkang/callback?code=link-code&state=" +
        (linkStart.searchParams.get("state") || ""),
    ),
  );
  assert.equal(linked.token, null);
  assert.equal(linked.userId, userId);

  const attached = await emailRoute.POST(
    emailRequest(
      {
        action: "link",
        email: "student@example.test",
        password: "correct-horse",
      },
      cookieHeader(google.token!),
    ),
  );
  assert.equal(attached.status, 200);
  const providers = identitiesFor(userId).map((item) => item.provider).sort();
  assert.deepEqual(providers, ["email", "google", "tamkang"]);

  const returned = await finishTamkang(
    new Request(
      "http://localhost:3242/api/auth/tamkang/callback?code=link-code&state=" +
        new URL(await startTamkang("login")).searchParams.get("state"),
    ),
  );
  assert.equal(returned.userId, userId);
  const password = loginEmail("student@example.test", "correct-horse");
  assert.ok(password.token);
  assert.equal(getUser(userId)?.email, "google.user@example.test");
});

test("same email without an explicit link does not merge Tamkang and Email users", async () => {
  const created = await emailRoute.POST(
    emailRequest({
      action: "register",
      email: "shared@example.test",
      password: "correct-horse",
      name: "Email Owner",
    }),
  );
  assert.equal(created.status, 201);
  const emailUser = await (
    await emailRoute.POST(
      emailRequest({
        action: "login",
        email: "shared@example.test",
        password: "correct-horse",
      }),
    )
  ).json();
  assert.equal(emailUser.signedIn, true);
  const emailOwner = findUserByEmail("shared@example.test");
  const tamkang = await finishTamkang(
    new Request(
      "http://localhost:3242/api/auth/tamkang/callback?code=other-code&state=" +
        new URL(await startTamkang("login")).searchParams.get("state"),
    ),
  );
  assert.notEqual(tamkang.userId, emailOwner?.id);
  const steal = await emailRoute.POST(
    emailRequest(
      {
        action: "link",
        email: "shared@example.test",
        password: "another-horse",
      },
      cookieHeader(tamkang.token!),
    ),
  );
  assert.equal(steal.status, 409);
  const body = await steal.json();
  assert.match(body.error?.message || "", /未自動合併/);
});

test("email link requires a signed-in session", async () => {
  const response = await emailRoute.POST(
    emailRequest({
      action: "link",
      email: "anon@example.test",
      password: "correct-horse",
    }),
  );
  assert.equal(response.status, 401);
});

test("account UI links Email and does not offer unconfigured Tamkang as success", async () => {
  const account = await readFile(
    join(process.cwd(), "components/settings/AccountSettings.tsx"),
    "utf8",
  );
  const menu = await readFile(
    join(process.cwd(), "components/auth/AccountMenu.tsx"),
    "utf8",
  );
  assert.match(account, /連結電子信箱/);
  assert.match(account, /淡江 SSO 尚未完成設定/);
  assert.match(menu, /淡江 SSO 尚未完成設定/);
  assert.match(account, /action: "link"/);
});
