## Why

The extraction pipeline now spans Rust (NAPI crate), 6 TS packages with ordered build dependencies, a Vite plugin with subprocess-based system resolution, and a showcase app that serves as the integration proof. After shipping per-property bail, token alias syntax, and global styles in a single session, debugging time was dominated by stale caches — a React resolve alias in vite.config.ts silently broke transforms, and the `.vite` transform cache served stale results even after code changes. The existing `clean` script only removes `dist/` and `target/`, missing the highest-risk cache layers entirely. The `verify` scripts don't include the showcase build, so `verify:full` can pass while the extraction proof is broken.

## What Changes

- **Tiered clean scripts**: `clean:light` (Vite cache + dist — fast, covers 80% of stale-cache issues), `clean:full` (all caches including Rust target, NAPI binary, tsbuildinfo), `clean` remains as-is for backward compatibility
- **Cache-aware verify**: `verify:full` includes showcase build as the extraction integration gate. New `verify:showcase` for focused extraction verification
- **Rebuild script**: `rebuild` = `clean:full` + `build:all` — guaranteed fresh state, single command
- **Package-level CLAUDE.md files**: Developer knowledge docs for `extract/`, `vite-plugin/`, and `showcase/` encoding cache behavior, debugging procedures, rebuild requirements, and known failure modes
- **Root CLAUDE.md addendum**: Monorepo-level build order, verification loop, and common debugging scenarios appended to existing cognitive bootstrap

## Capabilities

### New Capabilities
- `build-verification`: Requirements for build scripts, clean tiers, verification gates, and the dependency-ordered rebuild pipeline
- `developer-knowledge-docs`: Requirements for what CLAUDE.md files must contain per package — cache locations, debugging procedures, known failure modes, and verification commands

### Modified Capabilities
_(none — these are new tooling/DX capabilities, no existing spec behavior changes)_

## Impact

- **Root `package.json`**: New script entries (non-breaking additions)
- **`packages/extract/CLAUDE.md`**: New file — Rust crate rebuild, NAPI binary, cargo cache behavior
- **`packages/vite-plugin/CLAUDE.md`**: New file — subprocess model, `.vite` cache, debug logging, transform pipeline
- **`packages/showcase/CLAUDE.md`**: New file — extraction proof, what breaks it, how to verify
- **Root `CLAUDE.md`**: Addendum section (preserves existing SYZYGY bootstrap)
- **No source code changes** — this is purely build tooling and developer documentation
