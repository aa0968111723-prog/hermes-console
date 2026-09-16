# Release checklist

Do not merge until each line is actually true, or explicitly marked **Partial**.

## Mobile

- [ ] Chat: only conversation pane scrolls; composer stays visible
- [ ] Projects / Inspiration / Agent / Settings scroll to the bottom
- [ ] Android Chrome keyboard: composer visible, send visible, close restores height
- [ ] Safe area: composer, dock, dialogs
- [ ] Viewports: 360×800, 390×844, 412×915, 430×932, 768×1024

## Auth

- [ ] AuthGate before workspace
- [ ] Google Authorization Code + PKCE, or honest unconfigured
- [ ] Tamkang SSO real IdP, or 「淡江 SSO 尚未完成設定」
- [ ] Email register / login / verify / magic link / reset
- [ ] No auto-merge by email
- [ ] Logout clears session
- [ ] Anonymous `/api/workspace` is 401
- [ ] Members cannot GET/POST `/api/settings/credentials`; owners and admins can

## Chat / Agent

- [ ] Natural-language request does not require picking GALLEY / Canva / Tamkang
- [ ] Unconfigured submit 503 is student copy, not env-var names
- [ ] Invalid Hermes key / hanging Hermes submit copy stays student-safe
- [ ] Cancel hits backend
- [ ] Restart leaves running chat tasks `uncertain` (no auto-resend)
- [ ] Unverified vision: image asks continue without pixel pretence
- [ ] Composer image chips wrap on 390×844; local thumbnail while uploading
- [ ] Empty tool output is not success
- [ ] Offline banner; reconnect does not drop the thread

## MCP

- [ ] Registry statuses: unconfigured / verifying / available / partial / failed
- [ ] Unreachable = failed; missing token = unconfigured; listTools only = partial

## Artifacts / Memory

- [ ] Stable artifact + revision ids
- [ ] Memory layers not dumped into one blob

## DB / Security / Tests / Deploy

- [ ] Backup taken (`npm run backup` or volume snapshot)
- [ ] `npm run rehearse` reports required env; optional Google / Tamkang / Hermes stay honest
- [ ] No secrets in client, logs, or git
- [ ] `npm run lint` `typecheck` `test` `test:ui` `test:entry` `test:chat` `test:workbench` `test:gateway` `test:runtime` `build`
- [ ] `/api/health` returns 200 while the process is up even if Hermes is down
- [ ] `/api/ready` on the target host
- [ ] Rollback snapshot identified

Known gaps must be listed as Partial in the PR. Do not paint them green.
