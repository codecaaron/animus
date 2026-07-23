# arch-css-structural-gates Specification

## Purpose
TBD - created by archiving change modern-css-surface. Update Purpose after archive.
## Requirements
### Requirement: Condition at-rules gated inside layer blocks

Consumer verification lanes SHALL run a structural assertion that every `@container`, `@supports`, and non-breakpoint `@media` at-rule in assembled dist CSS sits inside a named `@layer` block, and the vite-app and next-app assert lanes SHALL invoke it non-vacuously (their dists contain condition at-rules).

#### Scenario: Vite-app lane runs the containment check

- **WHEN** the following command is run

```bash
vp run "@animus-ui/vite-app#verify:assert"
```

- **THEN** it exits 0 with `assertConditionsInsideLayers` invoked against a dist whose CSS contains at least one `@container`, one `@supports`, and one non-breakpoint `@media` rule
- **AND** a hoisted (outside-`@layer`) condition at-rule in that dist causes the command to exit non-zero

#### Scenario: Next-app lane runs the containment check

- **WHEN** the following command is run

```bash
vp run "@animus-ui/next-app#verify:assert"
```

- **THEN** it exits 0 with the same assertion invoked against the Next dist CSS

### Requirement: Registered property rules gated in the variables part

The showcase assert lane SHALL pin the registered-`@property` wire end-to-end: the dist CSS contains the theme's registered `@property` rule, positioned before the first `@layer` block.

#### Scenario: Showcase lane pins @property placement

- **WHEN** the following command is run

```bash
vp run "@animus-ui/showcase#verify:assert"
```

- **THEN** it exits 0 with the dist CSS containing `@property --current-bg` before the first `@layer` block
- **AND** removing the registration from the showcase theme (or the wire dropping it) causes the command to exit non-zero

