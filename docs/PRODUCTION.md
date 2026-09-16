# Production deployment

Hermes Console is a long-running Node.js app. It is not a serverless function.

## Architecture

User → Hermes Console (this repo) → Hermes Agent → Planner / Tools / MCP → External services → Artifacts.

Console stores identity, workspace, conversations, tasks, memory, and artifacts. Hermes executes tools. Do not pretend MCP, SSO, or sync succeeded.

## Zeabur

- One replica.
- Persistent volume on `CONSOLE_DATA_DIR` (container default `/app/data`).
- Optional `DATABASE_URL` for Console-owned Postgres tables only (`console_records` / `console_sessions` / `console_limits`). Never point this at `ai_os` or `cutos_memory_items`.
- Public HTTPS domain in `CONSOLE_ORIGIN`.
- Health: `GET /api/health` (liveness + store + Hermes probe, no secrets).
- Readiness: `GET /api/ready` (store probe only). App live ≠ Agent ready.

## Environment

Copy `.env.example`. Generate **new** secrets. Rotate anything that was ever pasted into chat, issues, README, or logs.

Required for a public deployment:

- `CONSOLE_ORIGIN` (exact HTTPS origin)
- Persistent `CONSOLE_DATA_DIR` or `DATABASE_URL`
- `CONSOLE_GATEWAY_SECRET` (≥32 chars) and `CONSOLE_REQUIRE_GATEWAY=true` unless the origin is already private

Optional, honest unconfigured if blank:

- `HERMES_API_URL` / `HERMES_API_KEY`
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
- `TAMKANG_SSO_*` (do not invent a client)
- MCP URLs/tokens (`TKU_`, `GALLEY_`, `XUNHE_`, `ATLAS_`, `LUMEN_`, `FRAMELAB_`, `DUIGAO_`, `MCP_BRIDGE_TOKEN`, `CONSOLE_MCP_SERVERS_JSON`)
- `RESEND_API_KEY` / `CONSOLE_EMAIL_FROM` (needed for verification, magic link, and password reset mail). Without them the login screen must say **尚未設定寄件，無法寄送登入或重設連結** and must not show a send form.
- Canva / Zeabur / Instagram / Pinterest

`CONSOLE_ALLOW_LOCAL_ACCESS=true` is loopback-only.

## Database

- SQLite under `CONSOLE_DATA_DIR` when `DATABASE_URL` is unset.
- Schema changes must be explicit migrations. Do not auto-mutate production on boot beyond the existing empty-Postgres←SQLite one-time move.
- Backup the volume and `vault.key` before deploy. Losing the vault key makes stored credentials unreadable.
- Rollback: restore the volume / Postgres dump, then start the previous image.

## OAuth

Google uses Authorization Code + PKCE. Secrets stay on the server. Callback: `{CONSOLE_ORIGIN}/api/auth/google/callback`.

## Tamkang SSO

Until the school issues a real client id, issuer/metadata, and protocol (OIDC / OAuth / SAML / CAS), the UI must show **淡江 SSO 尚未完成設定**. Do not collect campus passwords. Do not crawl login pages. Do not mark SSO available.

Tamkang MCP is a separate connection. Token paste is the primary path. Optional MCP credential exchange is collapsed under 設定 → 連線 → 淡江 → 「MCP 權杖交換（不是淡江 SSO）」 and is not school login.

## MCP

Configure HTTPS endpoints only. GitHub URLs are rejected. Private networks and metadata IPs are rejected unless an explicit allowlist/loopback test flag is on.

Status meaning:

- `unconfigured` — missing URL or token
- `verifying` — probe in progress / initialize-only leftover
- `partial` — `tools/list` succeeded; not a safe-read proof
- `available` — a safe read actually succeeded
- `failed` — unreachable, protocol error, or invalid schema

`tools/list` is never a green “connected” success.

## Domain / HTTPS

Set `CONSOLE_ORIGIN` to the public origin. Cookies use `Secure` on HTTPS. Mutations check `Origin`.

## Health

| Path | Auth | Meaning |
| --- | --- | --- |
| `GET /api/health` | public | Process live, store probe, Hermes discovery if configured. Includes `live`, `ready`, `agentReady`. No secrets. |
| `GET /api/ready` | public | Store writable. 200 or 503. |
| `POST /api/health` | session + origin | Forced refresh. |

## Backup / rollback

1. Snapshot SQLite/Postgres and `vault.key`.
2. Deploy the new image.
3. Confirm `/api/ready` and a real login.
4. On failure, restore the snapshot and previous image. Do not rewrite git history.

This file does not authorize a production deploy. Deploy only with explicit owner approval.
