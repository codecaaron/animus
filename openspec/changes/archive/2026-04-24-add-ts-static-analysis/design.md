## Context

The repository's `verify:*` tier family is the authoritative verification surface. Biome covers per-file lint and format. There is no cross-module static-analysis capability installed today. The one-way topology rule (root `CLAUDE.md` § Workspace Topology) is documented honor-system with an explicit "candidate for a future CI grep or lint rule" note.

`fallow-rs` is a stable-rust static analyzer with a broad capability surface (verified from README fetch): 7 primary subcommands, 13 dead-code issue subclasses, duplicate-code detection, health/complexity metrics, architecture boundaries with presets + custom rules, an audit orchestrator with verdict semantics, and native baseline + regression-ratchet support. It ships 90 framework plugins and produces SARIF + PR-annotation output for GitHub CI.

This change installs the **capability**: the tier, helper, config file, baseline directory, CI job, Change-Type Map row. It does NOT set policy. Each policy decision becomes its own separately-reviewed change.

The sibling change `add-rust-dep-hygiene` installs the Rust hygiene capability via cargo-machete. The two together establish the `verify:hygiene:*` tier family — each sibling is capability-only.

## Goals / Non-Goals

**Goals:**
- Install the fallow capability surface: tier exists, config file exists, helper exists, baseline directory exists, CI job exists, Change-Type Map has a row, dev-script namespace is reserved.
- Enumerate in the spec every capability fallow provides that this repo might want to use later, so policy changes can reference mechanism without re-establishing it.
- Stay symmetric with the Rust-side hygiene capability install.
- Defer every policy decision to follow-on changes, enumerated in the proposal.

**Non-Goals:**
- Setting rule severities, threshold values, boundary rule contents, workspace/ignorePatterns contents, suppression entries.
- Deciding whether baselines are committed, regenerated, or with what tolerance.
- Deciding whether `verify:hygiene:ts` belongs in the `verify` fast-gate.
- Deciding CI output format choices (SARIF, annotations, Code Scanning upload).
- Codifying the one-way topology rule via `boundaries`.
- Populating `ignoreExports` for MDX or factory patterns.
- Writing a custom fallow plugin for `.mdx` files.
- Replacing Biome.

## Decisions

### Decision 1: `fallow-rs`, not `knip` or `ts-prune` or `tsr`

**Chosen**: `fallow-rs`.

**Rationale**: Stable-rust native binary, sub-second performance, 13 dead-code subclasses in one pass, built-in baseline + regression mechanism, architecture-boundaries mechanism, SARIF output. Covers the full capability surface the repo might want; no second tool required.

**Alternatives**: `knip` (TS-based, slower, narrower features, no boundaries), `ts-prune` (abandoned/superseded), `tsr` (narrow scope, no baselines).

### Decision 2: Capability install only — no policy in this change

**Chosen**: every specific value, severity, threshold, rule, or inclusion-decision is deferred to a separately-proposed follow-on policy change. Enumerated in the proposal under "Follow-on policy changes."

**Rationale**: Peer directive — capabilities enable policies; mixing the two in one change fragments review. Each policy is small, reviewable, and reversible on its own. This change stays laser-focused on capability install.

### Decision 3: `.fallowrc.json` at repo root (not in `package.json`, not TOML)

**Chosen**: `.fallowrc.json`.

**Rationale**: (a) `package.json` is dense; separating fallow config keeps it navigable. (b) JSON matches the repo's other config files (biome, tsconfigs). (c) Top-level file is discoverable.

### Decision 4: Baseline directory convention at `.fallow/`

**Chosen**: `.fallow/` directory at repo root, as the reserved location for all fallow-generated baseline/artifact files.

**Rationale**: Single stable location so follow-on policy changes can reference it. `fallow init` produces this as a convention; we preserve it.

### Decision 5: CI via `fallow-rs/fallow@v2` GitHub Action

**Chosen**: Use the official Action, major-version pinned.

**Rationale**: Action handles binary install, package-manager detection, and output-format plumbing. Manual step would reimplement all of that. Major-pin allows automatic minor/patch uptake; follow-on CI policy change can SHA-pin if desired.

### Decision 6: `verify:ci` mirrors CI; `verify` fast-gate does NOT include the new tier

**Chosen**: update the `verify:ci` composite orchestrator to include `verify:hygiene:ts` (because CI gains a hygiene-ts job — verify:ci's job is to mirror CI faithfully). Do NOT modify the `verify` fast-gate composition.

**Rationale**: `verify:ci` is a capability (mirror of CI); adding the new tier is a capability-level update. The `verify` fast-gate is a policy surface (which tiers block inner-loop development) — whether the new tier joins is a policy question that deserves its own change after measured runtime data.

### Decision 7: Reserve `fallow:*` namespace with one script, not five

**Chosen**: register `fallow:audit` at minimum; additional `fallow:*` scripts are optional and MAY be added by follow-on policy changes.

**Rationale**: Reserving the namespace with one entry is enough to make the capability discoverable. Enumerating five specific scripts (audit, fix, fix:apply, watch, baseline) before knowing which are wanted is policy.

### Decision 8: Spec requirements describe mechanism, not prescription

**Chosen**: every requirement in `specs/ts-static-analysis/spec.md` describes what fallow makes available (e.g., "the `rules` key SHALL be configurable") rather than what values should live there ("severity X for rule Y").

**Rationale**: Mechanism survives across policy changes. Prescription rots as policy evolves. Keep spec concerns at the level of capability.

### Decision 9: MDX gap is acknowledged but not addressed

**Chosen**: spec includes an "MDX Gap Acknowledgment" requirement naming the gap and the mechanism (suppression forms) available to cover it. No prescription on how to use the mechanism.

**Rationale**: Surfacing the gap in the capability spec lets future policy changes reference it without rediscovering. Choosing between `ignoreExports` and JSDoc and custom-plugin is policy.

## Risks / Trade-offs

- **Capability install without policy produces a non-functional tier** → Acknowledged: `bun run verify:hygiene:ts` with an empty `.fallowrc.json` may produce many findings or pass trivially depending on fallow's defaults. That is expected — the tier is installed but not meaningful until policy populates the config. Follow-on policy changes bring it to life incrementally.
- **Developer without fallow installed** → `require_fallow_binary` emits an actionable install command, same pattern as `require_cargo_machete`.
- **CI job failure behavior** → the initial CI invocation uses default fallow flags. Whether the job exits green, warn, or red is policy-dependent. Reviewers should expect the first CI run after this change to surface calibration findings, not to block.
- **Spec fragmentation with sibling Rust proposal** → both modify `verification-tier-policy` additively. Task 8.x guards the case where archive ordering inverts.
- **Follow-on policy churn** → enumerating 12 planned follow-on changes (see proposal) is a lot of policy work. Each is small and independently reviewable; the capability install is the foundation that makes them composable.

## Migration Plan

This is a purely additive capability install. Rollback is revert-only.

Rollout steps (matches the Tasks):

1. Helper + tier script land (local runnable but probably produces noise).
2. `.fallowrc.json` minimal scaffold + `.fallow/` directory land.
3. `verify:hygiene:ts` script registered in `package.json`; `verify:ci` updated to mirror CI.
4. CI job lands with default invocation.
5. CLAUDE.md updated with tier row + Change-Type Map row + cross-reference.

Each follow-on policy change (enumerated in the proposal) is a separate rollout on its own cadence.

## Open Questions

All previously "open questions" about specific values (severities, thresholds, base-refs, tolerance, etc.) are reframed as policy decisions for follow-on changes. None are in scope for this capability install.

Remaining capability-level open questions:

- Exact shape of the minimal `.fallowrc.json` that fallow accepts without error. Implementation task 3.2 validates this by running fallow once against the scaffold.
- Whether `fallow init` would be a cleaner scaffolding path than hand-writing `.fallowrc.json`. Implementation may choose either; the result is the same capability.
- Whether the `fallow-rs/fallow@v2` GitHub Action is the only supported CI invocation or whether a bare `fallow` step is also valid. Implementation task 5.x verifies.
