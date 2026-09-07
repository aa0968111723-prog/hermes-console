# Post PR20 Agent OS Progress

## Current Phase

Phase 0 complete locally. Starting P0 Certification Framework.

## Completed

- Confirmed current `main` is `6d168ef` (Merge pull request #20).
- Read PR #19, PR #20, PR #21.
- Created `feat/post-pr20-agent-os` from latest main. Did not merge PR #10.
- First commit: `docs/LONG_TASK_PROGRESS.md`.
- Phase 0 audit of docs, UI, API, server, persistence, external paths.
- Wrote `docs/POST_PR20_BASELINE.md`.
- Copied work contract `docs/POST_PR20_LONG_TASK.md` onto the implementation branch.

## In Progress

- P0-A Certification types / registry / runner / store / evidence.
- P0-B Hermes per-capability certification (do not promote models-list to whole-Hermes verified).
- P0-C Zeabur read-only certification (no env/restart/redeploy in auto probe).
- P0-D Evidence kinds: LOCAL_UNIT / LOCAL_CONTRACT / LOCAL_BROWSER / LIVE_EXTERNAL / UNVERIFIED.

## Blocked

- Live Hermes / Tamkang / Zeabur / Canva credentials are not assumed present. Live verification stays UNVERIFIED until an explicit live probe with real credentials succeeds.

## Next Action

- Implement `lib/server/certification/*`, `GET/POST /api/certification`, settings capability panel, and `tests/certification.test.ts`.
- Then `npm run typecheck` and `npm test`.

## Tests

- command: not run yet (Phase 0 was audit/docs)
- result: pending P0 implementation

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
