# Security

## Secrets

API keys, OAuth client secrets, MCP tokens, Zeabur tokens, SSO secrets, and `CONSOLE_GATEWAY_SECRET` are server-only.

Forbidden:

- `localStorage` / client state
- `NEXT_PUBLIC_*` secrets
- `console.log` of tokens, cookies, Authorization headers, or passwords
- Git commits of `.env.local` or live credentials

Anything previously pasted into chat, issues, README, or logs is **compromised**. Rotate. Do not reuse.

`scripts/check-secrets.mjs` is a CI gate, not a rotation.

## Authentication

- Google: OAuth 2.0 authorization code + PKCE. State is a single-use hashed token.
- Tamkang: `TamkangAuthProvider` (OIDC / OAuth / SAML / CAS). Unconfigured returns 503 and the Chinese notice. No campus password collection for SSO. Owner-only Tamkang MCP token exchange is collapsed under 連線 → 淡江 and is not SSO.
- Email: Argon2id (`m=19456,t=2,p=1`). Magic link, verification, and password reset tokens are single-use and expire in 15 minutes.
- Identities do **not** auto-merge because emails match. Linking is explicit. Linking email sends a verification message when mail is configured; without mail the UI must not offer a form that would create an unverified password login. Password login checks the email identity verification flag.

Login ≠ authorization. APIs check `hermes_session` and workspace membership (`owner` / `admin` / `member`). Changing Hermes, MCP, Canva authorization, runtime bindings, or Zeabur credentials requires owner or admin on the server. Members may use the workspace and read MCP status. Hiding a button is not access control.

Test bypass (`NODE_TEST_CONTEXT` + `CONSOLE_TEST_SESSION`) is ignored when a real cookie is present and must never be set in production.

## Sessions

HttpOnly, SameSite=Lax, 12 hour max-age, Secure on HTTPS. Logout deletes the hashed session row and expires the cookie.

## MCP / SSRF

External MCP URLs must be HTTPS without credentials, query, or hash. Rejected: localhost (except explicit loopback test flag), `169.254.*`, private networks, metadata hosts, `file://`, `ftp://`, GitHub repo URLs.

## Other controls

- CSRF: mutation `Origin` must match `CONSOLE_ORIGIN`.
- Rate limits on auth and API.
- Destructive actions require a server-minted confirmation token. `confirmed=true` is not enough.
- Webhook/MCP bearer tokens are compared as hashes where applicable.
- Open redirects: OAuth callbacks only return to `CONSOLE_ORIGIN`.
- Production logs must not print cookies, tokens, or Authorization headers (`redact()`).

## Incident rotation

1. Revoke the leaked credential at the provider.
2. Generate a new secret in the host’s secret store.
3. Restart Console so vault/env caches refresh.
4. Treat stored copies (chat, CI logs, old images) as public.
