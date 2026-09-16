# Hermes Console development rules

- PRODUCT: Hermes Console is an authenticated Visual AI Agent Workspace. Opening `/` shows `AuthGate` first (Google / 淡江 SSO / Email). After login, `HermesConsole` is the only product UI. Do not add extra dashboards or prototype apps.
- Use Traditional Chinese and a fixed light, mobile-first interface.
- Never commit credentials or echo upstream secrets, errors, configuration, or authorization headers.
- Hermes is the only agent. No synthetic brain, XML tool execution, fabricated progress, or static connected states.
- Workspace APIs require a valid `hermes_session` plus workspace membership (`owner` / `admin` / `member`). Optional `CONSOLE_GATEWAY_SECRET` is deployment-level protection, not an account login. Verify origin for mutations, rate-limit, and keep secrets server-side. Test-only gateway/session bypass must never work in production.
- Tools execute in Hermes. Frontend renders structured events; never display internal reasoning.
- Preserve histories, project ownership, idempotency, and explicit uncertainty around interrupted operations.
- Verify real behavior. Distinguish contract tests from live integration evidence.
- Minimum 44px controls; IME-safe input; reduced-motion support.
- Do not deploy, publish externally, rewrite history, or force push without explicit authorization.
- Tamkang SSO and MCP must not be marked available unless the real IdP / endpoint is configured and verified. Unconfigured stays unconfigured.
