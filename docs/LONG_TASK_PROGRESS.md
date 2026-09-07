# Post PR20 Agent OS Progress

## Current Phase

Phase 0 — PR20 baseline audit

## Completed

- Confirmed current `main` is `6d168ef` (Merge pull request #20).
- Read PR #19 (credentials / Tamkang), PR #20 (shared memory + Zeabur), PR #21 (this long-task contract).
- Created implementation branch `feat/post-pr20-agent-os` from latest `main`.
- Did **not** merge PR #10 and did **not** implement on `docs/post-pr20-long-task-plan`.

## In Progress

- Phase 0 honest capability classification: UI → API → server → persistence → external service.
- Reading README, AGENTS.md, existing audit docs, frontend, backend, and API routes.

## Blocked

- Live Hermes / Tamkang / Zeabur / Canva credentials are not assumed present. Live verification is UNVERIFIED until an explicit live probe with real credentials succeeds.

## Next Action

- Finish Phase 0 audit and write `docs/POST_PR20_BASELINE.md`.
- Then implement P0 certification framework on this same branch.

## Tests

- command: not run yet (docs-only first commit)
- result: pending Phase 0 completion, then `npm run typecheck` + `npm test`

## Important Decisions

- CURRENT MAIN is the only source of truth.
- PR #10 is a capability-requirements source only, not an implementation source.
- Existing bright / chat-first / mobile-first UI stays. No homepage rewrite, no dark tech dashboard.
- Connected ≠ usable. Certification must be per-capability.
- Mock / local / browser / live evidence must stay separate labels.

## Live Verification

- Not started. No live external calls in this commit.

## Remaining Risks

- `HermesConsole.tsx` is large; later extraction must stay incremental.
- Shared memory `synced` is already documented as always false.
- Zeabur mutating operations exist; certification must start read-only.
- Research bundle may still be plan-only (`executed=false`).
- No-login product direction must be preserved while Zeabur ops are high-risk on a public URL.

## Last Successful Commit

- pending (this file is the first commit)

## Test Status

- not run

## Blockers

- none for Phase 0 local audit
