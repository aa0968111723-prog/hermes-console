# Hermes Console development rules

- PRODUCT INVARIANT: Hermes Console is a No-Login Single Workspace. Opening `/` must enter `HermesConsole` without email, password, registration, invitation gate, or member session. Do not add those unless the user explicitly re-requests them. Invitation modules may remain dormant; they must not block the workspace.
- Use Traditional Chinese and a fixed light, mobile-first interface.
- Never commit credentials or echo upstream secrets, errors, configuration, or authorization headers.
- Hermes is the only agent. No synthetic brain, XML tool execution, fabricated progress, or static connected states.
- Workspace APIs authenticate as the single `workspace` owner. Optional `CONSOLE_GATEWAY_SECRET` is deployment-level protection, not an account login. Verify origin for mutations, rate-limit, and keep secrets server-side. Test-only gateway bypass must never work in production.
- Tools execute in Hermes. Frontend renders structured events; never display internal reasoning.
- Preserve histories, project ownership, idempotency, and explicit uncertainty around interrupted operations.
- Verify real behavior. Distinguish contract tests from live integration evidence.
- Minimum 44px controls; IME-safe input; reduced-motion support.
- Do not deploy, publish externally, rewrite history, or force push without explicit authorization.
