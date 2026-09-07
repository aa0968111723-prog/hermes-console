# Visual-first Hermes workspace

## Audit

The existing Console behavior remains the source of truth for conversations, tasks, uploads, projects, MCP health, memory, settings and Canva results. The presentation layer now gives each surface a visual default and keeps engineering detail behind an explicit disclosure.

| Surface | Before | Now |
| --- | --- | --- |
| Welcome | Eyebrow, two explanatory paragraphs, CTA and six long buttons | Turtle Core, real-state orbit, one question and six icon actions; action detail appears on hover/focus |
| Dock | Full text sidebar always visible | 88px visual dock with labels on hover; history and settings remain available |
| Mobile navigation | Drawer only | Persistent 44px bottom dock plus existing drawer for history |
| Composer | Permanent mode, attachment and keyboard prose | Plus, prompt and send by default; existing attachment controls and keyboard semantics stay available |
| Runtime | Snapshot counts and tool schema in the first view | Human health summary first; snapshot, schema, permissions and diagnostics under Advanced |
| Integrations | Repeated list prose | Real integration state tiles; detail is expandable and state is never inferred from discovery |
| Artifacts | Plain Canva result block | Artifact Stage with actual preview/edit URL and provenance label |

No backend endpoint or integration contract was changed in this UI pass. A missing connection remains unknown/unconfigured; the orbit intentionally dims nodes that are not present in a verified Runtime snapshot.

## Depth and motion

`app/globals.css` defines canvas, surface, primary/accent, semantic status, radius, shadow, depth and motion tokens. The Core uses CSS perspective, two SVG-like CSS orbit rings, a contact shadow and pointer tilt capped at ±2° X / ±3° Y. It does not add WebGL or a per-card animation loop. `prefers-reduced-motion` removes transforms and animation; the existing turtle visibility listener pauses animation in hidden tabs.

## Verification

- `npm test` — 145 contract and integration tests pass.
- `npm run typecheck` — pass.
- `npm run build` — production build pass. Next reports the existing Windows worktree symlink tracing warning only.
- `npm run test:ui` — real Chrome production preview pass at 1440, 1024, 768, 430, 390 and 360px, including IME composition, Shift+Enter, reduced motion, no-login entry, uploads, scoped drafts, runtime, inspiration, settings and focus return. Screens are written to `output/playwright`.
- The same run recorded CLS `0` in local Chrome. LCP was unavailable (`null`) in the headless observer, so no LCP claim is made; measure it again on the deployed origin with field tooling.
- Captured views include `home-desktop.png`, `home-mobile.png`, `chat.png`, `projects.png`, `runtime-desktop.png`, `runtime-advanced.png`, `settings-desktop.png` and `settings-mobile-390.png`.

The browser run is a local isolated Console with external Hermes/Canva credentials intentionally unset. It verifies real Console handlers and honest unconfigured/offline states; it is not a claim that external services are live.

## Remaining

Live GALLEY/Canva/Tamkang provider checks still require the deployment's controlled URLs and current authorization. The next visual pass can connect Runtime snapshot data to the Agent page orbit without changing provider behavior.
