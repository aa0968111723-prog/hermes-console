# Hermes Console development rules

- Use Traditional Chinese and a fixed light, mobile-first interface.
- Never commit credentials or echo upstream secrets, errors, configuration, or authorization headers.
- Hermes is the only agent. No synthetic brain, XML tool execution, fabricated progress, or static connected states.
- This Console is email-invitation-only. Require a valid one-time-email-link session on workspace APIs; only administrators may invite/revoke members. A configured gateway remains defense in depth, never a replacement for membership. Preserve the current workspace data and do not claim email delivery or Hermes memory synchronization without evidence. Verify origin for mutations, rate-limit and keep secrets server-side. Test-only gateway bypass must never work in production.
- Tools execute in Hermes. Frontend renders structured events; never display internal reasoning.
- Preserve histories, project ownership, idempotency, and explicit uncertainty around interrupted operations.
- Verify real behavior. Distinguish contract tests from live integration evidence.
- Minimum 44px controls; IME-safe input; reduced-motion support.
- Do not deploy, publish externally, rewrite history, or force push without explicit authorization.
