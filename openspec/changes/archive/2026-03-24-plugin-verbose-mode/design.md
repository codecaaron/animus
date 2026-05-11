## Context

The Vite plugin (`packages/vite-plugin/src/index.ts`) orchestrates the extraction pipeline: it loads the system via subprocess, discovers files, calls `analyzeProject()` from the Rust NAPI crate, and serves the resulting CSS via a virtual module. The Rust crate already produces a structured `UniverseManifest` containing a `ReconciliationReport` (with `eliminated_details`) and a usage ledger (with `rendered_components`), but the plugin discards this diagnostic data after extracting the CSS string.

The plugin currently has zero structured logging. When extraction produces unexpected results, the only recourse is writing ad-hoc diagnostic scripts — which often fail on module resolution since the plugin runs in Vite's context with specific resolution rules.

## Goals / Non-Goals

**Goals:**
- Surface reconciliation elimination warnings to stderr so developers immediately see when components are dropped
- Provide verbose phase-by-phase logging behind an opt-in flag for deeper debugging
- Add phase timing so performance regressions are visible
- Keep output grep-friendly and structured

**Non-Goals:**
- Changing the Rust crate's output format (the manifest already has everything we need)
- Adding a debug UI or dashboard
- File-based log output or log rotation
- Changing any extraction behavior — this is purely observability

## Decisions

### 1. Two-tier logging: warnings (always) + verbose (opt-in)

Reconciliation elimination warnings always print via Vite's `config.logger.warn()`. These are the "your component disappeared" signals that should never be silent. Everything else (phase checkpoints, timing, transform details) is behind verbose mode.

**Rationale**: Silent component elimination is the #1 pain point. Making warnings always-on means the developer sees the problem immediately, not after a debugging session. Verbose mode adds noise that's only useful during active investigation.

**Alternative considered**: All logging behind verbose flag. Rejected because the whole point is that developers don't know they need to investigate — the warning has to be proactive.

### 2. Activation: `ANIMUS_DEBUG=1` env var OR `verbose: true` plugin option

The env var is preferred for CI/debugging (no code change required). The plugin option is for persistent verbose mode during development.

**Rationale**: Env var is the standard pattern for debug logging in Node.js tooling. Plugin option provides a code-level toggle for teams that want verbose logging as default during development.

### 3. Use Vite's built-in logger, not raw console

Access `config.logger` from the `configResolved` hook. Use `.info()` for verbose, `.warn()` for elimination warnings. This integrates with Vite's log level controls and output formatting.

**Rationale**: Using Vite's logger means `--logLevel silent` suppresses our output too, which is correct behavior for CI builds that pipe output. Raw console would bypass Vite's log management.

### 4. Prefix all output with `[animus]`

Every log line starts with `[animus]` for grep-ability.

**Rationale**: In a Vite build with multiple plugins, filtering to just extraction output needs a consistent prefix.

### 5. Parse manifest.report and manifest.usage in the plugin

The manifest JSON is already parsed. We just need to read `.report.eliminated_details[]` and `.report.components_extracted` / `.components_total` etc. No new Rust-side changes needed.

**Rationale**: Zero-cost on the Rust side. The data is already serialized. We're just reading what's already there.

## Risks / Trade-offs

- **[Risk] Warning noise on intentional elimination** → The reconciler correctly eliminates unused components. Warnings for these are technically false alarms. Mitigation: the warning message includes the reason ("not rendered and not a parent"), so developers can distinguish intentional from unexpected.
- **[Risk] Verbose mode performance cost** → Phase timing adds `performance.now()` calls. Mitigation: negligible compared to Rust extraction and Vite bundling. Only active when verbose is on.
- **[Risk] Log format becomes a de facto API** → Other tools may parse our output. Mitigation: prefix with `[animus]` and keep format stable, but don't guarantee it. Structured JSON output is a future enhancement if needed.
