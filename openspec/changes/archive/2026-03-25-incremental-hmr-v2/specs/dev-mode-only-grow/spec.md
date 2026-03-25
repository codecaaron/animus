## ADDED Requirements

### Requirement: Dev-mode incremental JSX scanning and no reconciliation

When `analyzeProject()` is called with `dev_mode: true`, it SHALL perform JSX scanning ONLY on changed files (files whose cache entry was invalidated by a hash mismatch). Cached JSX usage results from unchanged files SHALL be reused. The reconciliation phase (Phase 5e) SHALL be skipped entirely — no variants, states, components, or system prop utilities are pruned.

New system prop values, variant usages, and state activations discovered in changed files SHALL be merged into the accumulated usage ledger via union (additive only). Values previously in the ledger from prior scans SHALL NOT be removed even if the changed file no longer references them.

#### Scenario: New system prop detected in changed file
- **WHEN** `analyzeProject()` is called with `dev_mode: true` and a changed file adds `<Box p={8}>` for the first time
- **THEN** the utility class for `p={8}` is generated and added to the CSS output

#### Scenario: Unchanged files not re-scanned
- **WHEN** `analyzeProject()` is called with `dev_mode: true` and 31 of 32 files are unchanged
- **THEN** JSX scanning runs only on the 1 changed file; cached scan results are reused for the other 31

#### Scenario: Dev-mode retains all variants
- **WHEN** `analyzeProject()` is called with `dev_mode: true` and a component has 5 variant options but only 2 are used in JSX
- **THEN** all 5 variant options appear in the generated CSS (no elimination)

#### Scenario: Dev-mode retains all states
- **WHEN** `analyzeProject()` is called with `dev_mode: true` and a component has 3 states but none are used in JSX
- **THEN** all 3 states appear in the generated CSS (no elimination)

#### Scenario: Dev-mode retains unused components
- **WHEN** `analyzeProject()` is called with `dev_mode: true` and a component is extracted but never rendered in JSX
- **THEN** the component's CSS is retained in the output (no elimination)

#### Scenario: Prod-mode unchanged
- **WHEN** `analyzeProject()` is called with `dev_mode: false` or `dev_mode` is not provided
- **THEN** full JSX scanning (all files) and reconciliation proceed as before (unchanged behavior)

---

### Requirement: Monotonic CSS growth in dev

During a dev session, CSS output SHALL only grow. Values encountered for variants, states, and system prop utilities SHALL accumulate across HMR cycles. A value once included in CSS SHALL NOT be removed until a geological reset or server restart.

#### Scenario: New variant value persists
- **WHEN** a developer adds a new variant value to a component and triggers HMR
- **THEN** the new variant's CSS is added to the output, and previously-generated CSS for that component is preserved

#### Scenario: Removed variant value persists in dev
- **WHEN** a developer removes a variant option from source code and triggers HMR
- **THEN** the removed variant's CSS remains in dev output until a geological reset or server restart

#### Scenario: Geological reset restores accurate CSS
- **WHEN** a geological reset occurs (theme/config/system change)
- **THEN** the cache is cleared and full analysis produces CSS reflecting only the current source state (monotonic accumulation resets)
