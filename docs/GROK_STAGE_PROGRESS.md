# Grok Staged Long-Run Progress

## Current Phase
Phase 0 complete locally; starting Phase 1.

## Observed Main SHA
`7efcc06142a770f218a150f241354fd8fcda245f` (PR #11 merged)

## Observed PR #10 SHA
`55abdee98cd9805051ccd3548f00383233960f13` (`feat/hermes-creative-intelligence-loop`)

## Latest Antigravity findings reviewed
- Cycle 1 (Hermes API, 2026-09-05): 404-as-online, unused `executeHermesTool`, chars/2.5 usage, `0.0.0.0` SSRF, static 7 profiles.
- Cycle 2 (Tamkang/MCP, 2026-09-06): REST-not-JSON-RPC, unused MCP SDK, HTTP 200 ≠ Verified.

### Classification
| Finding | Class | Status |
| --- | --- | --- |
| 404 treated as Hermes online | VERIFIED BUG | RESOLVED in `4546414` / discovery.ts |
| `0.0.0.0` SSRF | SECURITY RISK | RESOLVED in `4546414` |
| unused `executeHermesTool` / no SSE tool loop | PARTIAL IMPLEMENTATION | claimed RESOLVED in Iteration 2; re-check in Phase 1 |
| chars/2.5 usage | STATIC / FAKE | claimed RESOLVED via `stream_options.include_usage`; re-check in Phase 2 |
| 7 Agent Profiles hardcoded | STATIC | labeled `console_role` in Phase 0; discovery in Phase 1 |
| Tamkang REST GET not JSON-RPC | VERIFIED BUG | claimed RESOLVED via MCP SDK client; re-check in Phase 3 |
| MCP HTTP 200 = Verified / Connected | STATIC / FAKE | Phase 0: Unconfigured/Partial unless initialize+tools/list |
| +4% / 98/100 as real lift | STATIC / FAKE | Phase 0: AI_SIMULATED_HEURISTIC copy |
| Instagram env-only Connected | STATIC / FAKE | Phase 0: Needs Authorization / Partial |
| Personas 小涵/阿倫/廷宇/小琪/V導 | STATIC | fixture until Phase 5 |

## Completed
- Truthful integration statuses for Tamkang, Instagram, Pinterest, Canva, MCP catalog.
- Console roles labeled `kind: console_role`; not claimed as live `/p/<profile>`.
- Console seed memories labeled `sourceLayer: console_seed`; psychology items are hypotheses.
- Orchestrator re-eval summary no longer claims real +4% / 98/100 satisfaction.

## Verified
- PR #10 head already includes main (PR #8/#9/#11).
- Cycle 1 404-as-online and `0.0.0.0` SSRF still look fixed in current `discovery.ts` / security tests.
- No-login workspace remains from main.

## Still partial
- Hermes named profile discovery (`/p/<profile>`) not configuration-driven.
- Feature detection for `/health`, `/v1/skills`, `/v1/toolsets`, runs, sessions is incomplete.
- Audience Twin still uses named fixtures (Phase 5).
- Tamkang local notes still used as research fallback (must stay labeled not-MCP).
- Canva / Meta / Pinterest / TKU live authorization: EXTERNAL BLOCKER.

## External blockers
- Live Hermes named profiles and scoped keys.
- `TKU_MCP_URL` live endpoint.
- Canva user OAuth.
- Meta Graph / Instagram publish OAuth.
- Pinterest official API.

## Tests run
- `npm test`: 70/70 pass (sequential `--test-concurrency=1`; parallel same-process run pollutes `HERMES_API_*`)
- `npm run typecheck`: pass
- `npm run check:secrets`: PASS, 188 files, no legacy secret literals
- `npm run build`: pass, Next.js 15.5.25, 43 routes

## Tests failed
None after sequential test runner. Parallel `tsx --test` previously failed `security-tasks` due to shared env, not due to product regressions.

## Security findings
- Previously pasted Hermes keys / dashboard passwords remain compromised; not copied into code.
- GitHub URL still rejected as MCP (`githubIsNotMcp`).

## Files modified
- `lib/server/integrations/truth-status.ts`
- `lib/server/social/instagram-research.ts`
- `lib/server/orchestrator/task-orchestrator.ts`
- `lib/server/hermes/registry.ts`
- `lib/server/hermes/memory.ts`
- `lib/server/mcp/registry.ts`
- `lib/server/mcp/types.ts`
- `lib/server/mcp-registry.ts`
- `app/api/hermes/profiles/route.ts`
- `tests/phase0_truthful_baseline.test.ts`
- `tests/phase9_orchestrator_truth.test.ts`
- `tests/phase10_instagram_publish.test.ts`
- `docs/GROK_STAGE_PROGRESS.md`

## Commit
`chore: establish truthful integration baseline`

## Next Phase
Phase 1 — Hermes control plane, profile sessions, feature detection.
