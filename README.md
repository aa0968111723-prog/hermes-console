# Hermes Console

Visual AI Agent Workspace for Hermes. Traditional Chinese, light, mobile-first.

A person opens the site, signs in, talks to Hermes, and gets research / drafts / artifacts. They should not have to pick MCP servers or read JSON.

This is **not** a no-login demo. `/` shows AuthGate, then Hermes Console.

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

Human → Console → Hermes Agent → Planner → Memory → Tools → MCP → External services → Artifacts.

## Setup

Node.js 22.13+ (24 LTS recommended). One long-running Node process and a writable volume. Not serverless.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000. Production: `npm run build` then `npm start`.

## Environment

See `.env.example` and [docs/PRODUCTION.md](docs/PRODUCTION.md).

| Area | Variables | Honest default |
| --- | --- | --- |
| Origin | `CONSOLE_ORIGIN` | Required in production |
| Data | `CONSOLE_DATA_DIR` or `DATABASE_URL` | SQLite if unset |
| Hermes | `HERMES_API_URL`, `HERMES_API_KEY` | Unconfigured UI |
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | 「尚未完成設定」 |
| Tamkang SSO | `TAMKANG_SSO_*` | 「淡江 SSO 尚未完成設定」 until a real IdP client exists |
| Email mail | `RESEND_API_KEY`, `CONSOLE_EMAIL_FROM` | First owner can register without mail; verification/reset need mail |
| MCP | `*_MCP_URL` / `*_MCP_TOKEN`, `MCP_BRIDGE_TOKEN` | Unconfigured / failed, never fake-connected |
| Gateway | `CONSOLE_GATEWAY_SECRET` | Deployment protection, not login |

Rotate any credential that was ever committed or pasted.

## Auth

Google (authorization code + PKCE), Tamkang SSO (real IdP only), Email (Argon2id, magic link, verify, reset). One User with explicit identity linking. APIs require session + membership. Changing Hermes / MCP / Zeabur credentials requires owner or admin; hiding a settings tab is not access control.

## MCP

Single registry. Statuses: unconfigured, verifying, available, partial, failed. `tools/list` is partial, not available.

## Development

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:ui
npm run test:entry
```

Contract tests are not live Zeabur / Canva / campus SSO evidence.

## Deploy

[docs/PRODUCTION.md](docs/PRODUCTION.md). Do not deploy without explicit authorization.

## Tests / security

[docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md), [docs/SECURITY.md](docs/SECURITY.md).
