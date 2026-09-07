# Post PR20 Agent OS Progress

## Current Phase

P1 Context / Goal / Planner / Tool Router / Fallback implemented locally. Next: P2 Research Executor.

## Completed

- Confirmed current `main` is `6d168ef` (Merge pull request #20).
- Phase 0 baseline: `docs/POST_PR20_BASELINE.md`.
- P0 certification layer, API, settings panel, evidence kinds.
- P1 context engine, goal interpreter, planner, tool router, visible fallbacks.
- Task dialog shows the user-visible plan. Chat-first UI unchanged.

## In Progress

- P2 Research Executor (plan → query → source → evidence → claim). `executed=true` only with external evidence.

## Blocked

- Live Hermes / Tamkang / Zeabur / Canva credentials are not assumed present.

## Next Action

- Implement `lib/server/research/executor.ts` with allowlisted official-source fetch.
- Then Zeabur mutation confirmation (P4-C).

## Tests

- command: `npm run typecheck && npm test`
- result: pass (112 tests) LOCAL_CONTRACT; sharp WASM used only in this android-arm64 agent environment, not committed

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
