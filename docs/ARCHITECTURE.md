# Architecture

```
Human
  → Hermes Console (AuthGate + visual workspace)
    → Hermes Agent
      → Planner / reasoning
        → Memory (conversation / project / workspace / preference / runtime)
        → Tools
          → MCP registry
            → External services
              → Artifacts / results
```

Hermes Console is the human interface to that runtime. It is not a tool directory, MCP dashboard, Canva clone, or ChatGPT clone.

## Console responsibilities

- Authenticate the user (Google / Tamkang SSO / Email) and authorize workspace membership (`owner` / `admin` / `member`). Connection secrets require owner or admin.
- Render conversations, projects, inspiration, artifacts, and turtle state.
- Persist workspace data (SQLite or Console Postgres).
- Expose Workspace MCP to Hermes. Probe external MCP. Never fake `available`.
- Show high-level progress in the normal UI. Schema, endpoints, receipts, env-var requirements, and tool names stay in 進階 / Developer. Member GET `/api/integrations` and `/api/agents` return `view: normal` without those fields. Developer dumps (`/api/runtime/tools`, `/mcp`, `/agents`, `/bindings`, `/api/certification`, `/api/usage`) require owner or admin.

## Hermes responsibilities

- Plan, call tools, write memory through Workspace MCP, create artifacts.
- Respect confirmation, cancel, budget, and max-step limits.
- Do not expose chain-of-thought.

## Data

Records live in one store (`kind` + `owner` + `id`):

User / Identity / Session / Membership / Project / Conversation / Message / Task / Tool receipt / Material / Artifact (copy revisions) / Memory.

Memory rows have `scope`, `layer`, `source`, `confidence`, `updatedAt`. They are not a remote Hermes mirror unless separately verified.

## Trust

Unconfigured integrations stay unconfigured. `tools/list` is `partial`. Empty HTTP 200 is not success. Interrupted tasks are `uncertain`, not still running.
