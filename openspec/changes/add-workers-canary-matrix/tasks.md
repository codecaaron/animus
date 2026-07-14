<!--
The Increment Registry is the single source of truth for decomposition state.
Packet files for lazy rows are created only after their cited signal appears.
-->

## 1. Increments

- [x] 01 [mode:inline · review:subagent] increments/01-dependency-envelope.md — resolves: DEF-1,D7,D8,D9 · authors: — · deps: — · inputs: — · footprint: .tool-versions,AGENTS.md,CLAUDE.md,package.json,bun.lock,packages/showcase/package.json,e2e/vite-app/package.json,e2e/vinext-app/package.json,e2e/react-router-app/package.json,scripts/verify/workers-config.test.ts · ticked: 2026-07-14 01:40 EDT
- [x] 02 [mode:delegate · review:subagent] increments/02-showcase-worker.md — resolves: D1,D2,D3,D7 · authors: — · deps: 01 · inputs: 01 · footprint: packages/showcase/wrangler.jsonc,packages/showcase/package.json · ticked: 2026-07-14 01:58 EDT
- [x] 03 [mode:delegate · review:subagent] increments/03-vite-worker.md — resolves: D3,D4 · authors: — · deps: 01 · inputs: 01 · footprint: e2e/vite-app/src/**,e2e/vite-app/worker/**,e2e/vite-app/scripts/**,e2e/vite-app/vite.config.ts,e2e/vite-app/wrangler.jsonc · ticked: 2026-07-14 02:09 EDT
- [x] 04 [mode:inline · review:subagent] increments/04-vinext-canary.md — materialized 2026-07-14 01:40 EDT from D9 · resolves: DEF-3,D3,D5,D10 · authors: — · deps: 01 · inputs: 01 · footprint: e2e/vinext-app/**,!e2e/vinext-app/package.json · ticked: 2026-07-14 02:24 EDT
- [x] 05 [mode:inline · review:subagent] increments/05-react-router-canary.md — materialized 2026-07-14 02:28 EDT from D9,D10 · resolves: DEF-2,D3,D5,D11 · authors: — · deps: 04 · inputs: 01,04 · footprint: e2e/react-router-app/**,!e2e/react-router-app/package.json,packages/vite-plugin/src/**,packages/vite-plugin/tests/** · ticked: 2026-07-14 02:37 EDT
- [x] 06 [mode:delegate · review:subagent] increments/06-workers-cutover.md — materialized 2026-07-14 02:42 EDT from D11 · resolves: D1,D2,D6,D7 · authors: — · deps: 02,03,04,05 · inputs: 02,03,04,05 · footprint: vite.config.ts,scripts/verify/**,AGENTS.md,package.json,.gitignore,netlify.toml · ticked: 2026-07-14 03:11 EDT

## 2. Cross-cutting

- [ ] 2.1 gate:ops update `animus`, create/connect the three new Workers, and smoke deployed URLs after local gates pass — ops:OPS-1,OPS-2,OPS-3,OPS-4 · partial: four Workers deployed/smoked 2026-07-14 11:50 EDT; Git Builds connections/settings remain
