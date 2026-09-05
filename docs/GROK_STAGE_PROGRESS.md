# Grok Staged Long-Run Progress

## Current Phase
Phase 1 complete locally; starting Phase 2.

## Observed Main SHA
`7efcc06142a770f218a150f241354fd8fcda245f` (PR #11 merged)

## Observed PR #10 SHA
`a40c2d6` Phase 0 truthful baseline on `feat/hermes-creative-intelligence-loop` (parent `55abdee`)

## Latest Antigravity findings reviewed
- Cycle 1 (Hermes API): 404-as-online RESOLVED; static 7 profiles labeled `console_role` in Phase 0 and resolved from env in Phase 1; `/health` `/v1/skills` `/v1/toolsets` now feature-detected instead of assumed.
- Cycle 2 (Tamkang/MCP): REST-not-JSON-RPC claimed RESOLVED earlier; HTTP 200 ≠ Verified handled in Phase 0. Re-check live MCP in Phase 3.

### Classification
| Finding | Class | Status |
| --- | --- | --- |
| 404 treated as Hermes online | VERIFIED BUG | RESOLVED |
| `0.0.0.0` SSRF | SECURITY RISK | RESOLVED |
| 7 Agent Profiles hardcoded as live Hermes | STATIC | Phase 1: console role ≠ Hermes profile; named profiles from env `/p/<profile>` + credential references |
| Client-supplied probe URL/key | SECURITY RISK | Phase 1: `/api/hermes/probe` rejects `baseUrl`/`apiKey` |
| chars/2.5 usage fallback | STATIC / FAKE | still used only when upstream usage missing; Phase 2 |
| Personas 小涵/阿倫/廷宇/小琪/V導 | STATIC | fixture until Phase 5 |

## Completed
- Phase 0 truthful integration baseline (`a40c2d6`).
- Phase 1 Hermes control plane: env-driven named profiles, per-endpoint feature states, session key prefixes, Project A/B isolation, conversation id ≠ session key.

## Verified
- Default Hermes works when named profiles are absent.
- Missing named profile does not crash; explicit error + default fallback.
- `/v1/models` 200 + `/v1/skills` 404 → skills `unsupported`, not fake available.
- Secrets stay in `process.env` credential references; not serialized in profile JSON.
- `npm test` 76/76; `typecheck`; `check:secrets`.

## Still partial
- Upstream usage still falls back to char estimates when Hermes omits `usage` (Phase 2).
- Memory is still console seed + in-memory, not Hermes MEMORY.md (Phase 2).
- Audience Twin named fixtures (Phase 5).
- Tamkang local notes are not MCP (Phase 3).

## External blockers
- Live Hermes named profiles and scoped keys.
- `TKU_MCP_URL` live endpoint.
- Canva user OAuth.
- Meta Graph / Instagram publish OAuth.
- Pinterest official API.

## Tests run
- `npm test`: 76/76 pass
- `npm run typecheck`: pass
- `npm run check:secrets`: PASS

## Tests failed
None.

## Security findings
- Probe route no longer accepts client Hermes URL or API key.
- Previously pasted secrets remain compromised; not copied into code.

## Files modified
- `lib/server/hermes/target.ts` (new)
- `lib/server/hermes/discovery.ts`
- `lib/server/hermes/session.ts`
- `lib/server/hermes/client.ts`
- `lib/server/hermes/registry.ts`
- `lib/server/hermes/index.ts`
- `lib/server/hermes.ts` (`sessionKeyFor` audience)
- `app/api/hermes/probe/route.ts`
- `app/api/hermes/profiles/route.ts`
- `tests/phase1_hermes_control_plane.test.ts`
- `docs/GROK_STAGE_PROGRESS.md`

## Commit
`feat: harden Hermes control plane and profile sessions`

## Next Phase
Phase 2 — Hermes memory, usage, and task telemetry.
