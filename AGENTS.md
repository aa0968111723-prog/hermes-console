# Hermes Console development rules

- PRODUCT INVARIANT: Hermes Console is a signed-in Visual AI Agent Workspace. Opening `/` shows `AuthGate` first (Google / Tamkang SSO / Email). The workspace loads only after a server-side session and workspace membership. Isolated loopback tests may set `CONSOLE_ALLOW_LOCAL_ACCESS=true` to skip the gate; that bypass must never work on public production. Invitation modules may remain dormant; they must not be the product login.
- Use Traditional Chinese and a fixed light, mobile-first interface.
- Never commit credentials or echo upstream secrets, errors, configuration, or authorization headers.
- Hermes is the only agent. No synthetic brain, XML tool execution, fabricated progress, or static connected states.
- Workspace records still use the single `workspace` owner. APIs must verify session + membership when auth is enforced, plus Origin, rate-limit, and server-side secrets. Optional `CONSOLE_GATEWAY_SECRET` is deployment-level protection, not an account login. Test-only gateway bypass must never work in production.
- Tools execute in Hermes. Frontend renders structured events; never display internal reasoning.
- Preserve histories, project ownership, idempotency, and explicit uncertainty around interrupted operations.
- Verify real behavior. Distinguish contract tests from live integration evidence.
- Minimum 44px controls; IME-safe input; reduced-motion support.
- Do not deploy, publish externally, rewrite history, or force push without explicit authorization.
- Tamkang SSO must jump to the school IdP. If issuer/client metadata is missing, show「淡江 SSO 尚未完成設定」. Never collect school passwords in Hermes Console login.
