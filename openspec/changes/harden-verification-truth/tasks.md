## 1. Increments

- [ ] 01 [mode:delegate · review:subagent] increments/01-exact-release-artifacts.md — resolves: D1,D2,D3 · authors: — · deps: — · inputs: — · footprint: .github/workflows/ci.yaml,scripts/verify/packed.sh,scripts/verify/postpack-smoke.sh,scripts/verify/packed-graph.*,e2e/packed-app/**,packages/*/package.json,bun.lock
- [ ] 02 [mode:inline · review:subagent] increments/02-observed-verification-paths.md — resolves: D4,D7,D8,DEF-1 · authors: — · deps: 01 · inputs: — · footprint: vite.config.ts,packages/vite-plugin/**,packages/next-plugin/**,packages/_assertions/**,scripts/assert-showcase-build.ts,e2e/{vite-app,next-app,vinext-app,react-router-app}/**,scripts/verify/{_preconditions.sh,build-consumer.sh,assert-consumer.sh,packed.sh},scripts/verify/**test*
- [ ] 03 [mode:inline · review:subagent] increments/03-fail-closed-suppressions.md — resolves: D5,D6,DEF-2 · authors: — · deps: 01,02 · inputs: — · footprint: vite.config.ts,scripts/verify/{clippy.sh,hygiene-rust.sh,packed.sh,rust-policy.*},scripts/hygiene/**,packages/{properties,system}/**,openspec/specs/{verification-tier-policy,code-hygiene,packed-consumer-verification}/**
- [ ] 04 [mode:inline · review:subagent-if-available] (lazy — blocked on: DEF-3) — resolves: DEF-3 · authors: — · deps: 03 · inputs: — · footprint: AGENTS.md,scripts/hygiene/**

## 2. Cross-cutting

None.
