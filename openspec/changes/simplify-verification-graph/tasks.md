## 1. Increments

- [x] 01 [mode:delegate · review:subagent] increments/01-package-owned-consumer-claims.md — resolves: D1,D6 · authors: — · deps: — · inputs: — · footprint: packages/showcase/package.json,e2e/*/package.json,vite.config.ts,scripts/verify/{_preconditions.sh,workspace-graph.ts,owner-graph.test.ts,build-consumer.sh,assert-consumer.sh} · ticked: 2026-07-18 17:35
- [x] 02 [mode:delegate · review:subagent] increments/02-public-graph-and-ci-rewire.md — resolves: D2,D4,D5 · authors: — · deps: 01 · inputs: — · footprint: vite.config.ts,.github/workflows/ci.yaml,AGENTS.md,CLAUDE.md,scripts/verify/{owner-graph,ci-graph}.test.ts · ticked: 2026-07-18 18:03
- [x] 03 [mode:delegate · review:subagent] increments/03-remove-obsolete-consumer-orchestration.md — resolves: D3 · authors: — · deps: 02 · inputs: — · footprint: vite.config.ts,.github/workflows/ci.yaml,scripts/deploy/workers-nightly.sh,scripts/assert-showcase-build.ts,scripts/hygiene/{CLAUDE.md,presenter.ts},scripts/verify/{build-*,assert-*}.sh,scripts/verify/{owner-graph,workers-config}.test.ts,packages/{showcase,vite-plugin}/CLAUDE.md,packages/showcase/vite.config.ts,e2e/{next-app,vite-app,vinext-app,react-router-app}/**/*.{ts,md},AGENTS.md,CLAUDE.md · ticked: 2026-07-18 18:27

## 2. Cross-cutting

- [x] 2.1 Run strict OpenSpec validation, registry lint, proof-inventory guardrails, owner-graph contracts, packed-graph contracts, Worker contracts, and the minimum verification tiers for every touched implementation surface. · ticked: 2026-07-18 18:35
- [x] 2.2 Reconcile every cold-review and implementation-review finding with an explicit fix, rejection, or deferral before final verification. · ticked: 2026-07-18 18:35
