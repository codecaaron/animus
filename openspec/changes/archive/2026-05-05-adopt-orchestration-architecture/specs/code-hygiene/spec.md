## ADDED Requirements

### Requirement: Binding to orchestration-architecture

The code-hygiene cascade structure (Layer A biome safe → Layer B biome unsafe-scoped → Layer C home-roll deleter → Layer D knip), the safety envelope, the scan/fix-mode contract, and the recovery-snapshot semantics defined in this spec SHALL be realized through the orchestrator binding designated by the `orchestration-architecture` capability. The current binding uses `bun run hygiene` (or equivalently `bash scripts/hygiene/run.sh`) and shells out to `biome` and `knip` for layers A/B and D respectively.

A future rebind to a different linter/formatter (e.g., `vp check` / Oxc via the `migrate-lint-to-vp-check` follow-on policy change) SHALL preserve the cascade structure: Layer A's safe-fix semantics, Layer B's scoped DELETE-only semantics, Layer C's home-roll deleter (which closes biome's intra-file dead-decl gap), Layer D's knip-driven cross-file pruning. The rebind MAY substitute the underlying tool for layers A and B (e.g., Oxc-equivalents) provided the layer's semantic contract is preserved.

The end-of-work-only contract (`bun run hygiene` SHALL NOT appear in any CI workflow) is invariant under orchestrator rebind. The hygiene surface remains a human-or-agent-invoked tool, never a CI gate, regardless of which orchestrator dispatches it.

#### Scenario: Cascade structure survives linter rebind

- **WHEN** a cutover follow-on rebinds the linter (e.g., biome → `vp check`)
- **THEN** Layer A continues to apply only safe-fix transformations
- **AND** Layer B continues to be scoped DELETE-only (no `noConsole`, no rename-as-fix)
- **AND** Layer C continues to delete intra-file dead declarations the linter does not handle
- **AND** Layer D continues to invoke `knip --fix` for cross-file pruning

#### Scenario: End-of-work-only contract survives orchestrator rebind

- **WHEN** any cutover follow-on rebinds the orchestrator or linter
- **THEN** the hygiene entrypoint continues to be excluded from `.github/workflows/*.yaml` files
- **AND** any addition of a hygiene step to CI is rejected in code review
