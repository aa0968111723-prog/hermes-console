# Grok Staged Long-Run Progress

## Current Phase
Phase 9 complete locally; next is Phase 10.

## Observed Main SHA
`d24da9c85a2f5fd1362b3407c0be15fa99293ac6`

## Observed PR #10 SHA
`ae9b3b6` Phase 8 Canva workflow; this checkpoint adds Phase 9 safe social publishing.

## Latest Antigravity findings reviewed
- Cycle 1–2 Hermes/MCP truthful probes remain RESOLVED.
- MCP `publish_social_campaign` returned `published: true` in sandbox and confirmPublish fabricated `ig_live_` ids when ENABLE_LIVE_PUBLISH was on. Phase 9 never auto-posts to Meta Graph (irreversible); sandbox is `published: false` / `livePosted: false`.

### Classification
| Finding | Class | Status |
| --- | --- | --- |
| Sandbox `published: true` | FAKE-STATE | Phase 9: `describeMcpSandboxPublish` livePosted=false |
| Fabricated live Graph media ids | FAKE-STATE | Phase 9: queued sandbox even if ENABLE_LIVE_PUBLISH |
| Meta Graph live publish | EXTERNAL BLOCKER | Needs user OAuth; adapters/tests/degraded UX shipped |

## Completed
- Phase 0–8 as previously committed (`a40c2d6` … `ae9b3b6`).
- Phase 9 safe social publishing workflow: `prepareSafeSocialPublish` (confirmation, no autoRetry); creative pipelines attach workflow; MCP sandbox confirm does not claim a live post.

## Verified
- `prepareSafeSocialPublish` always `published: false`, `livePosted: false`, `requiresConfirmation: true`.
- Thin pipeline `publish.enabled` remains false here; `social.publish` is false.
- MCP confirm after token: `published: false`, `mode: sandbox_simulation`.
- `npm test` 124/124; `typecheck`; `check:secrets`.

## Still partial
- Live Hermes session history/search still unsupported until `/api/sessions`.
- Canva live design create/export blocked on user OAuth.
- Meta Graph / Instagram live publish blocked on OAuth (EXTERNAL BLOCKER).
- No-login integration security hardening (Phase 10).

## External blockers
- Live Hermes named profiles and scoped keys.
- `TKU_MCP_URL` live endpoint.
- Canva user OAuth.
- **Meta Graph / Instagram publish OAuth** (Phase 9 degraded UX shipped).
- Pinterest official API.

## Tests run
- `npm test`: 124/124 pass
- `npm run typecheck`: pass
- `npm run check:secrets`: PASS, 219 files

## Tests failed
None.

## Security findings
- No Connected/Verified without a real probe.
- Previously pasted secrets remain compromised; not copied into code.

## Files modified
- `lib/server/publish/safe-workflow.ts`
- `lib/server/publish.ts`
- `lib/server/mcp/registry.ts`
- `lib/server/creative/pipeline.ts`
- `lib/server/creative-workflow/pipeline.ts`
- `tests/phase4_mcp_inspiration.test.ts`
- `tests/phase9_safe_publish.test.ts`
- `docs/GROK_STAGE_PROGRESS.md`

## Commit
`feat: add safe social publishing workflow`

## Next Phase
Phase 10 — test: harden no-login integration security.
