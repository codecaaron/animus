## Purpose

Defines requirements for the `packed-consumer-verification` capability.
## Requirements
### Requirement: Packed tarball production

The packed verification lane SHALL produce npm tarballs for all five publishable packages (`properties`, `system`, `extract`, `vite-plugin`, `next-plugin`) and SHALL fail if any produced tarball's manifest retains a `workspace:` dependency specifier.

#### Scenario: All publishables packed

- **WHEN** `vp run verify:packed` runs with fresh upstream artifacts
- **THEN** five tarballs exist in the lane's staging directory, one per publishable package

#### Scenario: Workspace specifier leaks into a tarball

- **WHEN** a packed tarball's `package.json` contains a `workspace:` specifier in any dependency block
- **THEN** the lane fails with a message naming the offending package and specifier

### Requirement: Tarball export and type lint

Every packed tarball SHALL pass export-map consistency lint and, under the resolution modes declared as supported for that package, type-resolution lint; a lint failure in any tarball SHALL fail the lane with the tarball name and the reported violations. Any exemption from a resolution mode SHALL be scoped to named lint rules on named packages, recorded next to the lint invocation with the deferral it tracks, and the exempted package SHALL still gate on its remaining modes.

#### Scenario: Export map violation detected

- **WHEN** a packed tarball declares an `exports` entry whose target file is absent from the tarball or inconsistent across conditions
- **THEN** the lane fails and reports the package name and the violating export path

#### Scenario: Type resolution violation detected

- **WHEN** a packed tarball's declarations resolve differently than its runtime entrypoints under a resolution mode declared as supported for that package
- **THEN** the lane fails and reports the package name and the mismatched condition

#### Scenario: Exempted rule regresses in a non-exempted mode

- **WHEN** a package carrying a scoped lint-rule exemption fails type-resolution lint in a mode outside that exemption
- **THEN** the lane fails; the exemption does not widen beyond its named rules and package

### Requirement: Isolated non-workspace installation

The packed consumer SHALL install the five packages from local tarballs into an installation isolated from the monorepo workspace: no installed `@animus-ui/*` package may be a symlink into `packages/`, every installed `@animus-ui/*` version SHALL equal the packed version, transitive `@animus-ui/*` dependencies SHALL resolve to the local tarballs rather than a registry, and any other installed `@animus-ui/*` package SHALL be limited to the optional platform-binary dependencies declared by a packed package's own manifest.

#### Scenario: Workspace leakage detected

- **WHEN** any `node_modules/@animus-ui/*` entry in the packed consumer resolves as a symlink into the repository's `packages/` tree
- **THEN** the lane fails identifying the leaked package

#### Scenario: Registry version substituted for a local tarball

- **WHEN** an installed `@animus-ui/*` package's version differs from the version stamped in the corresponding packed tarball
- **THEN** the lane fails naming the package and both versions

### Requirement: Module loading from packed install

Each installed package's root entrypoint SHALL load successfully from the packed install through ESM `import`, and entrypoints exercised by repository consumers through CJS `require` SHALL load successfully that way; every other advertised module mode SHALL remain gated by tarball export and type-resolution lint.

#### Scenario: ESM entrypoint loads

- **WHEN** the packed consumer imports a package's root entrypoint via ESM
- **THEN** the import resolves without error and the package's documented top-level exports are defined

#### Scenario: CJS-consumed extractor entrypoints load

- **WHEN** the packed consumer requires the extract root and `engine-v2` entrypoints via CJS
- **THEN** each require resolves without error and exposes its expected extraction API

### Requirement: Published declaration consumption

Consumer TypeScript code referencing the packed packages SHALL type-check against the declarations shipped inside the tarballs, with no reliance on workspace source files or repo-internal path mappings.

#### Scenario: Consumer type-check passes

- **WHEN** the packed consumer's type-check runs against representative usage of each package's public API
- **THEN** the check exits zero using only declarations resolved from the packed install

#### Scenario: Declaration missing from a tarball

- **WHEN** a package's tarball omits a declaration file its `exports` or `types` fields reference
- **THEN** the consumer type-check fails and the lane reports the unresolved declaration

### Requirement: Packed consumer builds and assertions

The packed consumer SHALL complete a Vite production build and a Next production build using the packed plugins, and the existing positional output assertions SHALL pass against both build outputs.

#### Scenario: Vite build from packed install

- **WHEN** the packed consumer runs its Vite production build
- **THEN** the build exits zero and the positional assertions pass against its output

#### Scenario: Next build from packed install

- **WHEN** the packed consumer runs its Next production build
- **THEN** the build exits zero and the positional assertions pass against its output

### Requirement: Dual engine load proof

Both extractor engine entrypoints — the default engine export and the `engine-v2` subpath export of the extract package — SHALL load from the packed install with their native bindings resolved; failure to load either engine SHALL fail the lane.

#### Scenario: v1 engine loads from packed install

- **WHEN** the packed consumer loads the extract package's root entrypoint
- **THEN** the native extraction API is present and callable

#### Scenario: v2 engine loads from packed install

- **WHEN** the packed consumer loads the extract package's `engine-v2` subpath
- **THEN** the v2 native extraction API is present and callable

#### Scenario: An engine binary is missing from the packed artifacts

- **WHEN** either engine's native binary is absent for the runner platform in the packed install
- **THEN** the lane fails naming the missing engine and platform

### Requirement: Exact publish artifact verification

The packed consumer lane SHALL accept a prebuilt tarball set and exercise those tarballs without repacking their source directories.

#### Scenario: Prebuilt tarballs are supplied

- **WHEN** the packed consumer lane receives paths for all publishable package tarballs
- **THEN** every lint, install, load, type-check, build, assertion, and receipt step operates on those supplied files
- **AND** the lane does not create replacement tarballs

#### Scenario: Supplied tarball is missing

- **WHEN** a required publishable package tarball is absent from the supplied set
- **THEN** the lane exits non-zero and identifies the missing package

### Requirement: Unmasked internal dependency closure

The packed consumer SHALL install local publishable tarballs without an internal-package override and SHALL validate every installed `@animus-ui/*` package instance against the corresponding tested tarball.

#### Scenario: Embedded internal edge is stale

- **WHEN** a tested tarball embeds an internal dependency version different from the corresponding sibling tarball
- **THEN** packed verification exits non-zero and reports the dependent package, dependency name, expected version, and installed or declared version

#### Scenario: Nested internal package is substituted

- **WHEN** installation produces a nested or registry-sourced internal package instance that does not match the tested tarball version
- **THEN** packed verification exits non-zero and identifies the mismatched installed path

### Requirement: Suppressed type diagnostics remain bounded

The packed type-resolution gate SHALL fail when a new `internal-resolution-error` appears outside the exact accepted DEF-5 diagnostic set.

#### Scenario: Additional declaration resolution failure appears

- **WHEN** properties or system produces an additional internal-resolution diagnostic
- **THEN** the packed lane exits non-zero and reports the additional diagnostic

#### Scenario: Known DEF-5 diagnostics are removed

- **WHEN** declaration output no longer produces the accepted DEF-5 diagnostics
- **THEN** the packed lane exits non-zero until the obsolete exemption is removed

