import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-auth-tku-"));
process.env.CONSOLE_ORIGIN = "http://localhost:3311";
process.env.CONSOLE_AUTH_MODE = "required";
process.env.HERMES_ALLOW_LOOPBACK_HTTP = "true";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
delete process.env.TAMKANG_SSO_PROTOCOL;
delete process.env.TAMKANG_OIDC_ISSUER;
delete process.env.TAMKANG_CLIENT_ID;
delete process.env.TAMKANG_CLIENT_SECRET;
delete process.env.CONSOLE_GATEWAY_SECRET;

const { TamkangAuthProvider } = await import(
  "../lib/server/auth/providers/tamkang"
);
const { tamkangConfigured } = await import("../lib/server/auth/mode");
const route = await import("../app/api/auth/tamkang/route");
const { findIdentity, getUser } = await import("../lib/server/auth/identity");

function jwt(payload: Record<string, unknown>) {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString(
    "base64url",
  );
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return header + "." + body + ".sig";
}

test("Tamkang SSO stays unconfigured without official metadata", async () => {
  assert.equal(TamkangAuthProvider.isConfigured(), false);
  assert.equal(TamkangAuthProvider.unavailableMessage(), "淡江 SSO 尚未完成設定");
  await assert.rejects(
    () => TamkangAuthProvider.start(),
    /淡江 SSO 尚未完成設定/,
  );
  const response = await route.GET(
    new Request("http://localhost:3311/api/auth/tamkang"),
  );
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.match(body.message, /淡江 SSO 尚未完成設定/);
  assert.equal(body.configured, false);
});

test("SAML or CAS metadata does not fake a login", async () => {
  process.env.TAMKANG_SSO_PROTOCOL = "saml";
  process.env.TAMKANG_SSO_METADATA_URL = "https://sso.example.edu/metadata";
  process.env.TAMKANG_CLIENT_ID = "school-client";
  assert.equal(tamkangConfigured(), false);
  assert.equal(TamkangAuthProvider.isConfigured(), false);
  await assert.rejects(
    () => TamkangAuthProvider.start(),
    /淡江 SSO 尚未完成設定/,
  );
  delete process.env.TAMKANG_SSO_PROTOCOL;
  delete process.env.TAMKANG_SSO_METADATA_URL;
  delete process.env.TAMKANG_CLIENT_ID;
});

test("OIDC authorization code + PKCE starts only with issuer, client and secret", async () => {
  let nonce = "";
  const idp = createServer((req, res) => {
    if (req.url === "/.well-known/openid-configuration") {
      const issuer = "http://127.0.0.1:" + (idp.address() as AddressInfo).port;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          issuer,
          authorization_endpoint: issuer + "/authorize",
          token_endpoint: issuer + "/token",
        }),
      );
      return;
    }
    if (req.method === "POST" && req.url === "/token") {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk as Buffer));
      req.on("end", () => {
        const issuer = "http://127.0.0.1:" + (idp.address() as AddressInfo).port;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            id_token: jwt({
              sub: "tku-student-1",
              email: "student@example.edu",
              email_verified: true,
              name: "淡江同學",
              iss: issuer,
              aud: "tku-client",
              nonce,
              exp: Math.floor(Date.now() / 1000) + 600,
            }),
          }),
        );
      });
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => idp.listen(0, "127.0.0.1", resolve));
  const issuer = "http://127.0.0.1:" + (idp.address() as AddressInfo).port;
  process.env.TAMKANG_SSO_PROTOCOL = "oidc";
  process.env.TAMKANG_OIDC_ISSUER = issuer;
  process.env.TAMKANG_CLIENT_ID = "tku-client";
  process.env.TAMKANG_CLIENT_SECRET = "tku-secret";
  try {
    assert.equal(TamkangAuthProvider.isConfigured(), true);
    const location = await TamkangAuthProvider.start();
    const url = new URL(location);
    assert.equal(url.origin, issuer);
    assert.equal(url.pathname, "/authorize");
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.ok(url.searchParams.get("code_challenge"));
    assert.ok(!location.includes("tku-secret"));
    nonce = url.searchParams.get("nonce") || "";
    const state = url.searchParams.get("state") || "";
    const issued = await TamkangAuthProvider.callback(
      new URL(
        "http://localhost:3311/api/auth/tamkang/callback?code=demo-code&state=" +
          state,
      ),
    );
    assert.match(issued.header, /hermes_session=/);
    const identity = findIdentity("tamkang", "tku-student-1");
    assert.ok(identity);
    assert.equal(getUser(identity!.userId)?.name, "淡江同學");
  } finally {
    await new Promise<void>((resolve, reject) =>
      idp.close((error) => (error ? reject(error) : resolve())),
    );
    delete process.env.TAMKANG_SSO_PROTOCOL;
    delete process.env.TAMKANG_OIDC_ISSUER;
    delete process.env.TAMKANG_CLIENT_ID;
    delete process.env.TAMKANG_CLIENT_SECRET;
  }
});
