## MODIFIED Requirements

### Requirement: Build and assertion scripts

The Vite fixture package SHALL own its production `build`, `verify:build`, `verify:assert`, `verify:dry-run`, and complete `verify` scripts. Shared parameterized helpers SHALL provide fail-loud preflight and assertion behavior; no root Vite target family or per-target shell wrapper is required.

#### Scenario: Build script

- **WHEN** `bun run --filter '@animus-ui/vite-app' build` is executed
- **THEN** Vite SHALL build the app to `e2e/vite-app/dist/`

#### Scenario: Focused Vite verification

- **WHEN** a developer runs `vp run @animus-ui/vite-app#verify`
- **THEN** the preflighted production build executes before the TypeScript output assertion
- **AND** the credential-free Worker dry-run executes only after assertions pass

#### Scenario: Complete verification reaches Vite

- **WHEN** `vp run verify:full` selects consumer owner claims
- **THEN** the Vite fixture package-owned `verify` script executes

### Requirement: Post-build assertion validates keyframes extraction

The Vite package-owned assertion diagnostic and complete owner claim SHALL validate keyframe emission and animation-name integrity.

#### Scenario: Assertion script imports and invokes the helper

- **WHEN** `e2e/vite-app/scripts/assert-build.ts` is inspected
- **THEN** it SHALL import `assertKeyframesExtracted` from `@animus-ui/assertions`
- **AND** it SHALL call `assertKeyframesExtracted(css, { insideLayer: 'anm-global', minBlocks: <N>, minReferences: 1 })` where `<N>` matches the fixture's keyframe count

#### Scenario: Build failure when keyframes block is missing

- **WHEN** `vp run @animus-ui/vite-app#verify` produces CSS without an expected `@keyframes animus-kf-<hash>` block
- **THEN** the owner claim exits non-zero with assertion evidence

#### Scenario: Build failure when animation-name references are mangled with px

- **WHEN** the Vite assertion observes a unit-mangled animation-name reference
- **THEN** the package-owned assertion diagnostic exits non-zero

### Requirement: Vite Worker build preserves extraction assertions

The complete Vite owner claim SHALL preserve all extraction assertions against the Cloudflare Worker production output.

#### Scenario: Run focused Vite verification

- **WHEN** a developer runs `vp run @animus-ui/vite-app#verify`
- **THEN** Worker-compatible production output is built and structurally asserted

### Requirement: Vite Worker deployment dry run

The Vite package SHALL expose a credential-free `verify:dry-run` diagnostic and include it in the complete owner claim.

#### Scenario: Validate Vite Worker deployment output

- **WHEN** the Vite production output and config identify `animus-vite-canary`
- **AND** a developer runs `vp run @animus-ui/vite-app#verify:dry-run`
- **THEN** Wrangler validates the upload without changing remote state
