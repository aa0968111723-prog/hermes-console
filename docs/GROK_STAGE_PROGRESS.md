# Grok Staged Long-Run Progress

## Current Phase
Phase 4 complete locally; next is Phase 5.

## Observed Main SHA
`7efcc06142a770f218a150f241354fd8fcda245f` (PR #11 merged)

## Observed PR #10 SHA
`5a6d61f` Phase 3 verified MCP routing; this checkpoint adds Phase 4 truthful inspiration pipeline.

## Latest Antigravity findings reviewed
- Cycle 1 (Hermes API): 404-as-online RESOLVED; static 7 profiles labeled `console_role` in Phase 0 and resolved from env in Phase 1; `/health` `/v1/skills` `/v1/toolsets` now feature-detected instead of assumed.
- Cycle 2 (Tamkang/MCP): REST-not-JSON-RPC claimed RESOLVED earlier; HTTP 200 ≠ Verified handled in Phase 0. Re-check live MCP in Phase 3.
- Inspiration: curated palettes were presented as `web_trend` / live social extraction. Phase 4 labels them `console_fixture`, `liveFetch: false`; URL parse classifies HTTPS links and does not scrape; Instagram/Pinterest providers keep `globalSearch: false`.

### Classification
| Finding | Class | Status |
| --- | --- | --- |
| 404 treated as Hermes online | VERIFIED BUG | RESOLVED |
| `0.0.0.0` SSRF | SECURITY RISK | RESOLVED |
| 7 Agent Profiles hardcoded as live Hermes | STATIC | Phase 1: console role ≠ Hermes profile; named profiles from env `/p/<profile>` + credential references |
| Client-supplied probe URL/key | SECURITY RISK | Phase 1: `/api/hermes/probe` rejects `baseUrl`/`apiKey` |
| chars/2.5 usage fallback | STATIC / FAKE | Phase 2: omitted upstream usage is `tokenSource: unavailable`, not estimated |
| Curated palettes as live web/IG trends | STATIC / FAKE | Phase 4: `sourceKind: console_fixture`, no live fetch, no full-site search |
| `parseInspirationLink` implied scrape | STATIC / FAKE | Phase 4: `fetched: false`, heuristic notes, generic palette not Tamkang leak |
| Cross-campus inspiration fallback | STATIC | Phase 4: domain search never returns another campus palette |
| Personas 小涵/阿倫/廷宇/小琪/V導 | STATIC | fixture until Phase 5 |

## Completed
- Phase 0 truthful integration baseline (`a40c2d6`).
- Phase 1 Hermes control plane (`a231f50`).
- Phase 2 memory layers, usage telemetry, task limits: no fabricated MEMORY.md; usage records profile/project/conversation/run/tokens/tools; no USD estimate; orchestration clamped to depth 2 / 30 sources / 5 roles / 5 directions / 3 revisions.
- Phase 3 verified MCP routing: initialize/tools/list/safeRead required for Verified; Tamkang mapping uses description+schema; local notes labeled `console_notes`; project mappings do not leak.
- Phase 4 truthful universal inspiration pipeline: console style library labeled `console_fixture`; URL ingest classifies without fetch; providers `liveFetch: false` / `globalSearch: false`; domain-scoped palettes; orchestrator provenance `console_style_library`; `/api/inspiration` search returns `runInspirationPipeline`.

## Verified
- Default Hermes works when named profiles are absent.
- Missing named profile does not crash; explicit error + default fallback.
- Hermes memory layer reports unavailable instead of fake MEMORY.md.
- Usage `cost` is null when provider price is unknown.
- Inspiration search does not claim Instagram/Pinterest full-site search or live fetch.
- NTU inspiration results do not include 克難坡/福園/淡水暮色.
- `npm test` 93/93; `typecheck`; `check:secrets`.

## Still partial
- Live Hermes session history/search still unsupported until the instance exposes `/api/sessions`.
- Audience Twin named fixtures (Phase 5).
- Tamkang local notes labeled `console_notes` / Unconfigured until live MCP verify.
- Instagram/Pinterest remain Partial until official OAuth + API; URL ingest only.

## External blockers
- Live Hermes named profiles and scoped keys.
- `TKU_MCP_URL` live endpoint.
- Canva user OAuth.
- Meta Graph / Instagram publish OAuth.
- Pinterest official API.

## Tests run
- `npm test`: 93/93 pass
- `npm run typecheck`: pass
- `npm run check:secrets`: PASS, 210 files

## Tests failed
None.

## Security findings
- Probe route no longer accepts client Hermes URL or API key.
- Inspiration URL ingest still rejects loopback/userinfo HTTPS; no scrape.
- Previously pasted secrets remain compromised; not copied into code.

## Files modified
- `lib/server/inspiration/engine.ts`
- `lib/server/inspiration/providers.ts`
- `lib/server/inspiration/query.ts`
- `lib/server/orchestrator/task-orchestrator.ts`
- `app/api/inspiration/route.ts`
- `tests/phase4_inspiration_pipeline.test.ts`
- `docs/GROK_STAGE_PROGRESS.md`

## Commit
`feat: build truthful universal inspiration pipeline`

## Next Phase
Phase 5 — make Audience Twin contextual and evidence grounded.
