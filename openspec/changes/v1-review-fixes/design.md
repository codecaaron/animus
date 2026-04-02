## Context

Four bugs found by V2 review. All are silent failures or misleading errors in existing code paths. No new architecture needed — each is a targeted fix to an existing module.

## Goals / Non-Goals

**Goals:**
- Fix 4 concrete correctness issues identified by independent reviewers
- Maintain behavioral parity between static extraction and runtime dynamic paths
- Improve error diagnostics for system loading

**Non-Goals:**
- Redesigning applyPrefix API (just extend it)
- Redesigning loadSystem subprocess architecture
- Adding new UNITLESS_PROPERTIES (just deduplicating existing ones)

## Decisions

### 1. Shared UNITLESS_PROPERTIES module location

Extract to `packages/extract/pipeline/unitless-properties.ts` as a `Set<string>`. Import in both `unit-fallback.ts` and `resolveClasses.ts`.

**Rationale:** The pipeline package is the source of truth for CSS processing rules. The runtime depends on extract via the build pipeline anyway (the plugin injects the system-props module). Adding a shared constant doesn't create a new dependency — `resolveClasses.ts` is bundled into the system package at build time, so the import resolves at compile time, not runtime.

**Alternative considered:** Put it in system and import from extract. Rejected — system describes, extract processes. CSS processing rules belong in extract.

### 2. applyPrefix contextualVarsJson handling

Add `contextualVarsJson` as an optional parameter to `applyPrefix`. Apply the same `--name` → `--prefix-name` rewriting to the serialized contextual var names.

**Rationale:** The contextual vars generate CSS like `--current-bg: var(--color-bg)`. Both the `--current-bg` declaration name and the `var(--color-bg)` reference need prefixing. The existing `var()` reference regex already handles the reference side. The declaration name needs a separate pass since contextual var names use the `--current-{name}` convention, not the standard `--{scale}-{key}` pattern.

### 3. resolveTokenRefs opacity fix

Implement `color-mix(in srgb, {resolved} {opacity}%, transparent)` for the case where the resolved value is NOT a `var()` reference (raw value from a non-emitted scale). For the `var()` case, also emit `color-mix` — same formula as `resolveTokenAliases` in the pipeline.

**Rationale:** The Rust crate and the pipeline's `resolveTokenAliases` both handle this correctly. The theme-level resolver is the only path that drops opacity. Aligning it with the same formula ensures consistency.

### 4. loadSystem export detection improvement

Iterate all module exports and find any that satisfy `.toConfig()`. Report found exports in the error message. Fix `.serialize()` → `.toConfig()` in the error string.

**Rationale:** Auto-detecting any export with `.toConfig()` removes the magic name convention entirely. If zero or multiple candidates exist, throw a diagnostic naming what was found. This is strictly better than the current approach with no downsides.

## Risks / Trade-offs

- **[UNITLESS_PROPERTIES import path]** → `resolveClasses.ts` importing from extract means the system package build must resolve this at compile time. The tsdown bundler handles this via the workspace resolution. If the extract package isn't built, system's build fails. Mitigation: build order already enforces extract → system.
- **[loadSystem auto-detection]** → If a module exports multiple objects with `.toConfig()`, the error should list candidates rather than picking one arbitrarily. Mitigation: throw with candidate list and let the user choose by export name.
