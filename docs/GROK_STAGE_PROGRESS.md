# Grok Staged Long-Run Progress

## Current Phase
Phase 3 complete locally; next is Phase 4.

## Observed Main SHA
`7efcc06142a770f218a150f241354fd8fcda245f` (PR #11 merged)

## Observed PR #10 SHA
`a231f50` Phase 1 control plane; this checkpoint adds Phase 2 memory/usage/task telemetry.

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
| chars/2.5 usage fallback | STATIC / FAKE | Phase 2: omitted upstream usage is `tokenSource: unavailable`, not estimated |
| Personas 小涵/阿倫/廷宇/小琪/V導 | STATIC | fixture until Phase 5 |

## Completed
- Phase 0 truthful integration baseline (`a40c2d6`).
- Phase 1 Hermes control plane (`a231f50`).
- Phase 2 memory layers, usage telemetry, task limits: no fabricated MEMORY.md; usage records profile/project/conversation/run/tokens/tools; no USD estimate; orchestration clamped to depth 2 / 30 sources / 5 roles / 5 directions / 3 revisions.
- Phase 3 verified MCP routing: initialize/tools/list/safeRead required for Verified; Tamkang mapping uses description+schema; local notes labeled `console_notes`; project mappings do not leak.

## Verified
- Default Hermes works when named profiles are absent.
- Missing named profile does not crash; explicit error + default fallback.
- Hermes memory layer reports unavailable instead of fake MEMORY.md.
- Usage `cost` is null when provider price is unknown.
- `npm test` 85/85; `typecheck`; `check:secrets`.

## Still partial
- Live Hermes session history/search still unsupported until the instance exposes `/api/sessions`.
- Audience Twin named fixtures (Phase 5).
- Tamkang local notes labeled `console_notes` / Unconfigured until live MCP verify.

## External blockers
- Live Hermes named profiles and scoped keys.
- `TKU_MCP_URL` live endpoint.
- Canva user OAuth.
- Meta Graph / Instagram publish OAuth.
- Pinterest official API.

## Tests run
- `npm test`: 85/85 pass
- `npm run typecheck`: pass
- `npm run check:secrets`: PASS, 208 files

## Tests failed
None.

## Security findings
- Probe route no longer accepts client Hermes URL or API key.
- Previously pasted secrets remain compromised; not copied into code.

## Files modified
- `lib/server/tamkang.ts`
- `lib/server/mcp/tamkang-adapter.ts`
- `lib/server/mcp-registry.ts`
- `lib/server/projects/router.ts`
- `tests/phase3_mcp_routing.test.ts`
- `docs/GROK_STAGE_PROGRESS.md`

## Commit
`feat: add verified MCP and project tool routing`

## Next Phase
Phase 4 — truthful universal inspiration pipeline.
