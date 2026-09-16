# Hermes Console development rules

- PRODUCT INVARIANT: Hermes Console is a signed-in Visual AI Agent Workspace. Opening `/` shows `AuthGate` (Google / Tamkang SSO / Email) and only then `HermesConsole`. Unconfigured providers must show an honest unavailable state, never fake success. InvitationGate remains dormant and must not replace AuthGate. `CONSOLE_AUTH_MODE=workspace` is the contract-test / local fallback to a single `workspace` owner.
- Use Traditional Chinese and a fixed light, mobile-first interface.
- Never commit credentials or echo upstream secrets, errors, configuration, or authorization headers.
- Hermes is the only agent. No synthetic brain, XML tool execution, fabricated progress, or static connected states.
- Workspace APIs still persist as the single `workspace` owner. User access requires session + membership when auth is required. Optional `CONSOLE_GATEWAY_SECRET` is deployment-level protection, not an account login. Verify origin for mutations, rate-limit, and keep secrets server-side. Test-only gateway bypass must never work in production.
- Tools execute in Hermes. Frontend renders structured events; never display internal reasoning.
- Preserve histories, project ownership, idempotency, and explicit uncertainty around interrupted operations.
- Verify real behavior. Distinguish contract tests from live integration evidence.
- Minimum 44px controls; IME-safe input; reduced-motion support.
- Do not deploy, publish externally, rewrite history, or force push without explicit authorization.
