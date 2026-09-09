# Post PR20 Agent OS Progress

## Grok 02 Instagram Inspiration（2026-09-09）

- CURRENT_STATE：靈感板改為禪學社視覺語言模式，不是連結牆。
- DONE：5 張 tku_zc 封面判讀；Drive 115-1 網宣對照；8 keep / 3 avoid；Visual／Copy 交接。
- VERIFIED：caption 規則對應、GET `instagramConnected=false`、ingest 無 caption 時 `borrow=[]`。
- UNVERIFIED：限動實景、Reels 動態、完整 IG 格、現場文館左側照片。
- BLOCKERS：無 Meta 授權；茶會／演講地點 UNKNOWN。
- NEXT_BEST_TASK：115-1 網宣日曆 × 模式槽；9:16 社博限動規格。
- FILES_TOUCHED：`lib/server/inspiration/visual-language.ts`、`engine.ts`、`InspirationBoard.tsx`、`app/api/inspiration/route.ts`、tests、skill、handoff。
- PR：https://github.com/aa0968111723-prog/hermes-console/pull/78
- MAIN_SHA：`5e245e79668390deef4ccfb012cee889588cb719`


## Current Phase

P2 research executor and P4-C Zeabur confirmation done locally. Next: P3 budget UI / P4 resume UX / P5 task pill.

## Completed

- Confirmed current `main` is `6d168ef` (Merge pull request #20).
- Phase 0 baseline: `docs/POST_PR20_BASELINE.md`.
- P0 certification layer, API, settings panel, evidence kinds.
- P1 context engine, goal interpreter, planner, tool router, visible fallbacks.
- P2 allowlisted official-source research executor. `executed=true` only after a real page retrieve.
- P4-C Zeabur update_env / push keys / redeploy / restart require a server-minted confirmation token.

## In Progress

- Remaining Agent OS: parallel agents, budget UI, resume sheet, mobile task pill, memory provenance, persistence docs.

## Blocked

- Live Hermes / Tamkang / Zeabur / Canva credentials are not assumed present. No LIVE_EXTERNAL certification yet.

## Next Action

- Add memory provenance fields (source / createdBy / importance / lastUsedAt / confidence) without a second store.
- Add Task Status pill + bottom sheet (P5) without changing primary nav.
- Write PERSISTENCE_AUDIT / MULTI_REPLICA_READINESS / OPERATOR_SECURITY.

## Tests

- command: `npm run typecheck && npm test && npm run check:secrets`
- result: pass (116 tests) LOCAL_CONTRACT; secrets scan PASS. Browser journeys and live probes not run.

## Important Decisions

- CURRENT MAIN is the only source of truth.
- PR #10 is requirements only.
- Existing bright / chat-first / mobile-first UI stays.
- Connected ≠ usable. Certification is per-capability.
- Mock / local / browser / live evidence stay separate labels.
- Overall Hermes must remain at most `partial` until chat, runs, and tools are independently evidenced. A models list or one chat success must not mark the whole integration verified.
- Zeabur auto-certification is read-only. Mutations still require later explicit confirmation work (P4-C).
- Loopback / fixture HTTP is `LOCAL_CONTRACT`, never `LIVE_EXTERNAL`.

## Live Verification

- Not started. No live external calls in Phase 0.

## Remaining Risks

- `HermesConsole.tsx` is 2119 lines; extraction later must stay incremental.
- Shared memory `synced` is always false.
- Zeabur mutating operations exist without confirmation tokens.
- Research bundle is plan-only (`executed=false`).
- No-login + public URL + Zeabur mutations is an accepted product risk; document in P7, do not silently add login.
- Several older docs still describe invitation/gateway-required worlds.

## Last Successful Commit

- `d4f4435` docs: start post-PR20 Agent OS long-task progress log

## Test Status

- not run

## Blockers

- none for local P0 implementation
