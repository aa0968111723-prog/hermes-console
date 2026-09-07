# Grok Parallel Intelligence Loop

## Current goal
Deepen Inspiration, Tamkang research, Audience Twin evaluation, ranking, Canva audience bridge, project tool routing, and QA on top of merged main (`#9`). Do not fork no-login / Agent Registry / Session Key / MCP core.

## Repo commit observed
- Branch: `feat/grok-parallel-intelligence-loop` from `origin/main`
- HEAD at start: `57db186` (PR #9 merge)
- Parallel main-agent branch `feat/hermes-creative-intelligence-loop` is based on pre-#8 code (`local-brain`, `hermes-config`). **Do not merge or copy that architecture.**

## Main changes observed
PR #9 already shipped: no-login workspace, Agent Registry, Session Key, MCP registry probe, thin `lib/server/audience.ts` + `inspiration.ts` + `tamkang.ts`, Canva PKCE, confirmation tokens.

## Gap table

| Capability | Current | Real | Missing | Owner |
| ---------- | ------- | ---- | ------- | ----- |
| No-login / security / confirmation | shipped | yes | keep | Main Agent |
| Hermes Agent Registry / Session Key / Brain | shipped | discovery-based | keep | Main Agent |
| MCP Registry initialize/list/call | shipped | fixture-probed | keep | Main Agent |
| Inspiration URL ingest | partial | URL classify + store | provider interface, query parse, dedupe, analysis | Grok Agent |
| Instagram search | honest no | resolve URL only | Meta API when authorized | External Auth |
| Pinterest search | honest no | resolve URL only | official search when authorized | External Auth |
| Audience Twin | seed facts | evidence vs hypothesis | profile types, eval engine, debate roles, ranking | Grok Agent |
| Tamkang MCP | mapping + fallback | mapping only | research providers + source records | Grok Agent |
| Canva Autofill | shipped | yes when OAuth | audience→dataset spec / revision | Grok Agent |
| IG Publish | disabled + confirm | blocked | publisher contract | Grok Agent |
| Project MCP routing | unconfigured | GitHub≠MCP | intent→toolset router | Grok Agent |

## Completed
- G1 Inspiration Engine (providers, query parse, dedupe, analysis, no fake full-site search)
- G2 Tamkang research bundle + official source records + evidence/hypothesis labeling + MCP fallback copy
- G3 Audience profile/graph/eval/debate/scoring with simulation=true method=ai_heuristic
- G4 Ranking + diversity warnings
- G5 Canva spec + dataset validation (unconfigured → Needs Canva Authorization)
- G6 Project tool router (booth vs video)
- G7 Social drafts (feed/story/threads differ, publish=false)
- G8 Publisher contract (confirmation required, no auto retry)
- QA contract tests in tests/parallel-intelligence.test.ts
- API: /api/intelligence, extended /api/inspiration and /api/audience

## Current implementation
Shipped on this branch. Did not rewrite HermesConsole, store, or Hermes adapter.

## Tests
`npm test` 44 pass. `npm run typecheck` pass. `npm run check:secrets` pass.

## Failures
None yet.

## External research
- Instagram: no full-site search without Meta Graph API + user token. Public URL ingest only.
- Pinterest: official API is account/board scoped, not arbitrary site search.
- Tamkang: no live MCP URL in this environment.

## Integration limitations
Needs Credential Rotation for any previously exposed Hermes keys. No live IG/Pinterest/Canva/TKU credentials here.

## Potential merge conflicts
Other agent writes `lib/server/audience-twin/` and `lib/server/inspiration/engine.ts` on an old tree. We use `lib/server/inspiration/{providers,engine,query,dedupe}.ts` and `lib/server/audience/{engine,evaluation,...}.ts` beside existing barrels.

## Next target
Implement Inspiration Engine + Audience evaluation + ranking + tests.

## Blocked items
Live Meta / Pinterest / Tamkang MCP / Canva user OAuth.
