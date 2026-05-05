## ADDED Requirements

### Requirement: Binding to orchestration-architecture

The atomic-tier contract, composite orchestrators, shared precondition helper, Change-Type Map, and CI-simulation semantics defined in this spec are realized through the orchestrator binding designated by the `orchestration-architecture` capability. The current binding uses `bun run` to invoke `bash scripts/verify/<tier>.sh` per atomic tier. A future rebind to a different orchestrator (e.g., Vite+ via the `migrate-orchestrator-to-vp-run` follow-on policy change) SHALL preserve every behavioral requirement in this spec — atomic-tier isolation, loud-fail precondition shape, the `_preconditions.sh` semantics, the Change-Type Map's authoritativeness, the dist-staleness check pattern — while updating only the invocation surface.

The shell helper at `scripts/verify/_preconditions.sh` SHALL remain in place under any orchestrator binding until and unless an orchestrator-native hook demonstrably preserves every check defined therein with identical semantics. If no native equivalent exists, the orchestrator's task body for any precondition-bearing tier SHALL invoke the existing shell script (e.g., `bash scripts/verify/canary.sh`).

#### Scenario: Atomic-tier loud-fail contract survives orchestrator rebind

- **WHEN** a cutover follow-on rebinds the orchestrator
- **AND** an atomic tier (e.g., `verify:canary`) is invoked under the new binding
- **AND** an upstream artifact (e.g., the NAPI binary) is missing or stale
- **THEN** the binding emits a stderr line matching `ERROR: <what's missing or stale>. Run: <exact command>`
- **AND** exits non-zero
- **AND** does NOT trigger an upstream rebuild

#### Scenario: Change-Type Map remains authoritative after rebind

- **WHEN** a cutover follow-on rebinds the orchestrator
- **THEN** the Change-Type Map in root `CLAUDE.md` is updated in the SAME change to reflect the new invocation surface
- **AND** the map continues to be the authoritative agent-facing instructability surface for selecting minimum-tier sets
