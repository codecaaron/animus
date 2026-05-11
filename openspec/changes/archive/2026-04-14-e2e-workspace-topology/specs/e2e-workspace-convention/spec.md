## ADDED Requirements

### Requirement: e2e Directory Location

The repository SHALL contain an `e2e/` directory at the repository root, sibling to `packages/`, `legacy/`, `scripts/`, and `openspec/`. The `e2e/` directory SHALL hold consumer fixture applications whose test surface is a whole built app asserted against positional output.

#### Scenario: e2e is a top-level sibling

- **WHEN** a maintainer lists the repository root
- **THEN** `e2e/` appears as a top-level directory alongside `packages/`, `legacy/`, `scripts/`, `openspec/`

#### Scenario: Consumer fixture apps reside under e2e

- **WHEN** a maintainer locates consumer fixture apps (e.g., `next-app`, and in future changes `vite-app`)
- **THEN** they are found under `e2e/<name>/`, not `packages/<name>/`

### Requirement: What Belongs in e2e

A package SHALL reside under `e2e/` if and only if it meets all of the following criteria:

- It is a runnable application (Next.js, Vite, webpack, or equivalent), not a library.
- Its test surface is "build the app, assert properties of the built output" — not `bun test`.
- It exists to verify consumer-bundler integration or end-to-end pipeline behavior, not to ship to users.
- It is `private: true`.

Packages that are libraries (even private test-only ones like `test-ds` or `_assertions`) remain in `packages/`. Packages that are shipping applications (`showcase` if its primary purpose becomes deployment) remain in `packages/` at maintainer discretion.

#### Scenario: next-app qualifies

- **WHEN** evaluating `e2e/next-app`
- **THEN** it meets all criteria: Next.js application, asserted via shell/TS post-build assertions, exists to verify `next-plugin` extraction, `private: true`

#### Scenario: test-ds does NOT qualify

- **WHEN** evaluating `packages/test-ds`
- **THEN** it fails the first criterion (it is a library, not a runnable app) and therefore remains in `packages/`

#### Scenario: showcase remains in packages

- **WHEN** evaluating `packages/showcase`
- **THEN** it is a runnable Vite application AND asserted via post-build AND verifies bundler integration — however, it is also the deployed documentation site with external consumers (Netlify). Placement is at maintainer discretion; current decision is to keep it in `packages/` because deployment purpose dominates.

### Requirement: e2e Workspace Naming Convention

Directories under `e2e/` SHALL use bundler-keyed short names of the form `<bundler>-app` when the primary distinguishing concern is the bundler (e.g., `next-app`, `vite-app`, `webpack-app`). When the distinguishing concern is different (e.g., a specific feature being exercised), descriptive names SHALL be used.

The naming convention avoids redundancy with the `e2e/` parent (no `e2e/next-test-app` or `e2e/next-e2e-app`).

#### Scenario: Bundler-keyed names

- **WHEN** an `e2e/*` directory is named
- **THEN** bundler-specific fixtures use `<bundler>-app` (e.g., `next-app`, `vite-app`)

#### Scenario: No redundant prefixes

- **WHEN** an `e2e/*` directory is named
- **THEN** it does NOT contain `e2e`, `test`, or `fixture` as prefix/suffix (since `e2e/` already conveys this)

### Requirement: One-Way Dependency Rule

Source code in `e2e/*` MAY import from `packages/*`. Source code in `packages/*` MUST NOT import from `e2e/*`. Source code in `packages/*` and `e2e/*` MUST NOT import from `legacy/*`.

This rule mirrors the publish boundary: `packages/*` is the publish graph (plus deep-internal private packages); `e2e/*` is downstream verification infrastructure. Dependencies flow top-down (consumer direction).

#### Scenario: e2e imports packages

- **WHEN** a file in `e2e/next-app/src/` imports `@animus-ui/system`
- **THEN** the import is permitted (top-down, consumer direction)

#### Scenario: packages does NOT import e2e

- **WHEN** a file in `packages/system/src/` attempts to import from `e2e/next-app/`
- **THEN** the import is forbidden by this rule
- **AND** review SHOULD reject the change

#### Scenario: Neither imports legacy

- **WHEN** a file in `packages/` or `e2e/` imports from any `legacy/` path or any `@animus-ui/<archived-name>`
- **THEN** the import is forbidden by the `legacy-directory-topology` spec's one-way independence rule

### Requirement: Root CLAUDE.md Documents Workspace Topology

The root `CLAUDE.md` SHALL contain a `## Workspace Topology` section describing the three-directory convention:

- `packages/` — publishable packages + deep-internal private packages (`_integration`, `_assertions`, `test-ds`, `showcase`)
- `e2e/` — consumer fixture applications (build + assert post-build)
- `legacy/` — archived packages preserved for reference only

The section SHALL state the one-way dependency rule.

#### Scenario: Agent reads workspace topology

- **WHEN** an agent loads root `CLAUDE.md`
- **THEN** a `## Workspace Topology` section describes the three directories
- **AND** the one-way dependency rule is stated explicitly

### Requirement: e2e Directory Initial Contents

After this change is applied, `e2e/` SHALL contain exactly one subdirectory: `next-app/`, migrated from `packages/next-test-app/` via `git mv`.

Additional `e2e/*` directories (e.g., `vite-app`) MAY be added in subsequent changes.

#### Scenario: next-app is the initial member

- **WHEN** a maintainer lists `e2e/`
- **THEN** `next-app/` is the only subdirectory immediately after this change
