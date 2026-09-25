# Official Hermes contract only

This branch strips Hermes Console down to a frontend client of the official Hermes Agent API Server.

## Keep

Official Nous Research API Server (`hermes gateway`, default `:8642`):

- `GET /health` and `GET /health/detailed`
- `GET /v1/models`
- `GET /v1/capabilities`
- `POST /v1/chat/completions`
- `POST /v1/responses` plus `GET/DELETE /v1/responses/{id}`
- `POST /v1/runs` plus `GET /v1/runs/{id}`, `/events`, `/stop`, `/approval`
- `/api/sessions` plus `/{id}`, `/messages`, `/fork`, `/chat`, `/chat/stream`
- Bearer `API_SERVER_KEY` / `HERMES_API_KEY`
- `X-Hermes-Session-Key` for memory scope

Console surfaces that stay:

- chat / tasks / conversations
- connection settings for Hermes URL, key, model
- health / ready
- workspace store for local drafts only (not a second brain)

## Remove from product surface

These are not official Hermes API Server contract:

- Lumen, FrameLab, 對稿, GALLEY, Atlas, 訊核, Planform
- Tamkang SSO and Tamkang MCP
- Canva, Instagram, Pinterest publish/research
- Zeabur deploy-token control
- recruitment / audience personas / copywriting packs / inspiration lanes / creative workflow shells
- extra MCP registry targets other than a single optional workspace bridge

## Rules

- Never display Connected unless models + a real task/tool run succeeded.
- Discovery 404 for `/v1/skills` or `/v1/toolsets` is `unsupported`, not a hard failure.
- Accept `HERMES_API_URL` with or without trailing `/v1`.
- Loopback `http://127.0.0.1:8642` is allowed only when `HERMES_ALLOW_LOOPBACK_HTTP=true`.
- Do not invent tool progress. Render official SSE events only.
