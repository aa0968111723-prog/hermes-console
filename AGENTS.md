# Hermes Console development rules

- PRODUCT INVARIANT: Hermes Console is a signed-in single workspace. Opening `/` shows `AuthGate` first (Google / Tamkang SSO / Email). After session + workspace membership, render `HermesConsole`. Do not restore a no-login public workspace unless the user explicitly re-requests it. Invitation modules may remain dormant; they must not replace identity login.
- Use Traditional Chinese and a fixed light, mobile-first interface.
- Never commit credentials or echo upstream secrets, errors, configuration, or authorization headers.
- Hermes is the only agent. No synthetic brain, XML tool execution, fabricated progress, or static connected states.
- Workspace APIs authenticate with identity session **and** workspace membership. Optional `CONSOLE_GATEWAY_SECRET` is deployment-level protection, not an account login. Verify origin for mutations, rate-limit, and keep secrets server-side. Test-only gateway bypass must never work in production.
- Tools execute in Hermes. Frontend renders structured events; never display internal reasoning.
- Preserve histories, project ownership, idempotency, and explicit uncertainty around interrupted operations.
- Verify real behavior. Distinguish contract tests from live integration evidence. Never fake MCP, SSO, or production success.
- Minimum 44px controls; IME-safe input; reduced-motion support.
- Do not deploy, publish externally, rewrite history, or force push without explicit authorization.
