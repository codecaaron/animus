## Context

Animus's release job (`.github/workflows/ci.yaml:215`) is gated on the
`verify` job alone: lint and Rust hygiene run as parallel non-gating jobs, and
the Next/Vite consumer lanes (`verify:next`, `verify:vite` — both already in
the `vite.config.ts` task graph at lines 427/437) are absent from CI entirely.
Every fixture consumes `workspace:*`, so no lane exercises the packed npm
artifacts consumers install: exports maps, `files` whitelists,
platform-package resolution, and published declarations are unproven. Peer
ranges over-claim (`vite >=5`, `next >=14`) relative to fixture evidence
(Vite 8.1.4, Next 15.5.20 webpack, React 18). Two extractor engines coexist —
both plugins default to v2 (`vite-plugin/src/index.ts:237`,
`next-plugin/src/singleton.ts:93`) — and their distribution differs: v1 ships
per-platform `optionalDependencies`; v2 ships `crates/extract-v2/*.node`
inside the main tarball.

Root `package.json` workspaces are **explicitly enumerated** (no globs), so a
committed non-workspace consumer is outside the workspace by omission.

Full exploration record: `brainstorm.md` (immutable). This file wins every
conflict with `brainstorm.md` and `proposal.md`.

## Goals / Non-Goals

**Goals:**

- Release cannot publish unless lint, Rust hygiene, full verify, `verify:next`,
  `verify:vite`, and `verify:packed` are green.
- A `verify:packed` tier proves the five publishable tarballs install,
  type-check, load through their supported entrypoint modes, build under Vite and Next, pass the existing
  output assertions, and expose both extractor engines.
- Published peer ranges match fixture evidence exactly.
- Verification results record engine loaded / default / override / package
  form while v1 and v2 coexist.

**Non-Goals:**

- Windows / musl / Intel-mac native targets (later platform-matrix work).
- Package managers beyond npm for the packed lane (pnpm/Yarn/PnP are separate
  capability lanes later).
- Browser/Playwright conformance, Vinext/React Router lanes, Next 16
  Turbopack.
- Fuzzing, stable IR schemas, performance budgets, `animus doctor` — all
  sequenced behind the v2 default flip (see D6).
- Source-map propagation (`map: null` at `vite-plugin/src/index.ts:1308`) —
  belongs to v2 boundary correctness with a contract test, separate change.
- React peer-range changes (`system` peers `^18 || ^19`; the `^19` half is
  unbacked — see DEF-2).
- Machine-readable conformance-matrix rendering (receipts land here; the
  renderer comes once gates emit structured results).

## Decisions

### D1: Release gate composition

- **Choice**: `release.needs` expands to
  `[lint, hygiene-rust, verify, verify-next, verify-vite, verify-packed]`
  (job names per ci.yaml conventions). `verify:next` and `verify:vite` become
  CI jobs on the same push-triggered workflow, depending on the existing
  `build-extract` artifacts, running in parallel with `verify`.
- **Rationale**: the release gate must contain the defined blocking package and consumer proof set
  (NS2). Remote Worker deployment canaries remain operational, non-release-blocking evidence. Running the lanes on every push (not release-only)
  keeps failures close to the commit that caused them; they parallelize
  against `verify`, so wall-clock cost is bounded by the slowest lane, not the
  sum.
- **Alternatives considered**: keep `needs: verify` only (rejected — ships
  unproven claims); mirror `verify:ci` including coverage (rejected — coverage
  is not a support claim); run consumer lanes on release only (rejected —
  moves failure discovery to the worst possible moment, tag time).

### D2: `verify:packed` tier design

- **Choice**: a new atomic tier `verify:packed` in the `vite.config.ts` task
  graph, implemented as a script that:
  1. **Packs** all five publishables (`properties`, `system`, `extract`,
     `vite-plugin`, `next-plugin`) with `bun pm pack` into a scratch staging
     directory, then asserts no tarball manifest retains a `workspace:`
     specifier.
  2. **Lints tarballs**: `publint` and `@arethetypeswrong/cli` against each
     tarball; failures are tier failures.
  3. **Installs** into a committed consumer template at `e2e/packed-app/`
     (NOT added to the root `workspaces` list — exclusion by omission),
     copied to a scratch dir at runtime. The consumer's `package.json`
     declares the five packages as `file:` tarball paths AND carries an
     `overrides` block mapping every `@animus-ui/*` name to its tarball, so
     transitive resolution (e.g. `system` → `properties`) stays local instead
     of hitting the registry. Install runs with **npm** (registry-shaped
     linker; no bun workspace interference).
  4. **Exercises**: `node` ESM import of every package root plus targeted CJS
     require of the extractor entrypoints consumed that way; tarball lint gates
     each package's other advertised module modes; `tsc`-based consumption of published declarations (stable
     TypeScript semantics via tsgo per repo toolchain); a Vite production
     build and a Next production build reusing the existing fixture app
     sources; existing positional assertions from `@animus-ui/assertions`
     against both outputs.
  5. **Proves both engines**: loads `@animus-ui/extract` (v1) and
     `@animus-ui/extract/engine-v2` (v2) from the packed install, hard-failing
     if either entrypoint or its native binary is unresolvable.
  - Upstream preconditions (fail-loud, never rebuild): fresh v1 + v2 NAPI
    binaries, fresh `dist/` for all five packages, fresh `_assertions/dist/`.
- **Rationale**: this is the single highest-leverage new capability; every
  sub-check targets a failure class that `workspace:*` consumption structurally
  cannot catch. Reusing fixture app sources and `@animus-ui/assertions` keeps
  the lane cheap to maintain.
- **Alternatives considered**: local registry (verdaccio) for true
  registry-shaped install (rejected — heavy moving part; `file:` + `overrides`
  covers the resolution semantics that matter); generating the consumer wholly
  at runtime (rejected — a committed template is reviewable and diffable);
  bun as the packed-lane installer (rejected as primary — npm is the
  registry-shaped reference linker, and Bun ≥1.3.12 has a known
  `createRequire` types-condition bug; bun install can be added as a
  follow-up sentinel, see DEF-3).

### D3: Peer-range clamps

- **Choice**: `vite-plugin` peers `vite: ">=8 <9"`; `next-plugin` peers
  `next: ">=15 <16"`. `webpack: ">=5.0.0"` stays (exercised by the Next 15
  webpack fixture builds). React peers untouched (out of scope, DEF-2).
- **Rationale**: fixtures prove exactly Vite 8 and Next 15 webpack; every
  other major in the current ranges is aspiration. A peer range cannot
  distinguish Next 16 Turbopack from `next build --webpack`, so Next 16 stays
  excluded until that exact mode has a blocking fixture. Clamping converts doc
  drift into an install-time signal.
- **Alternatives considered**: keep open ranges + document the tested matrix
  (rejected — install-time signal beats prose); add Next 14 / older-Vite
  fixtures to keep the wider claims (rejected — expands the blocking matrix
  before the packed lane exists; can be earned back later).

### D4: Engine and package form as recorded dimensions

- **Choice**: each consumer-facing lane (`verify:next`, `verify:vite`,
  `verify:assert:*`, `verify:packed`) emits a small JSON receipt:
  `{ lane, host, hostVersion, mode, engineLoaded, engineDefault,
  engineOverride, packageForm }`. Consumer fixtures run the intended default
  engine only; the packed lane loads both engines as a distribution proof;
  semantic equivalence remains the parity harness's job (`verify:parity`).
  No host × engine cross-product runs.
- **Rationale**: while two engines coexist — and ship via *different
  mechanisms* (v1 per-platform packages, v2 fat main tarball) — a green lane
  is ambiguous without engine identity. Receipts are the precursor to the
  conformance-matrix renderer without building the renderer now.
- **Alternatives considered**: run every consumer lane under both engines
  (rejected — doubles blocking CI for equivalence the parity harness already
  proves); no recording (rejected — a v1→v2 default flip could silently change
  what "green" attests).

### D5: CLAUDE.md ownership updates ride in-change

- **Choice**: the same change adds the `verify:packed` row to the atomic-tier
  table, updates composite orchestrators that absorb the new lanes
  (`verify:full`, `verify:ci`), and adds Change-Type Map rows for
  `e2e/packed-app/**` and the packed-lane scripts.
- **Rationale**: root CLAUDE.md's ownership rule requires it; the tier tables
  are the single source of truth for verification commands.
- **Alternatives considered**: none — the rule is repo law.

### D6: Sequencing policy for compiler-fortress work

- **Choice**: parity-corpus growth proceeds now; fuzzing, stable IR schemas,
  performance budgets, and `animus doctor` are deferred until v2 is the
  default everywhere and v1 retirement is decided. Source maps are handled as
  a v2 boundary contract test in the v2 workstream.
- **Rationale**: fortress tooling against v1 is throwaway; against a
  mid-transplant v2 it targets a moving surface. Corpus growth is the
  exception because it feeds the parity oracle in both eras.
- **Alternatives considered**: parallel fortress track (rejected — splits a
  small team across a moving target); pausing corpus growth too (rejected —
  the corpus is the flip's safety net).

### D7: Supported type-resolution matrix for published artifacts

- **Choice** (revised at inc 07 landing): the packed lane gates tarball
  type-resolution per package surface — `attw --profile node16` for
  CJS/dual packages (`extract`, `vite-plugin`, `next-plugin`) and
  `attw --profile esm-only` for the ESM-only packages (`properties`,
  `system`) — plus `publint --strict` for all five. node10 is out of the
  supported contract; `require()` of the ESM-only packages is explicitly
  unsupported (that is what esm-only records). Declaration format must
  match runtime format per export condition. Original choice (uniform
  node16 profile) was falsified by inc 07: node16-from-CJS structurally
  cannot pass for pure-ESM packages, and `properties`/`system` are
  consumer-pinned to ESM (rquickjs `loadSystemModule` evaluates properties
  as ESM; system is the tree-shaken DS surface). Their remaining
  node16-ESM declaration-resolvability defect (extensionless specifiers
  from the bundler-mode tsgo emit) is deferred to DEF-5 and explicitly
  allowlisted in the lane (`--ignore-rules internal-resolution-error`,
  those two packages only — bundler mode must stay green); the allowlist
  is removed when DEF-5 resolves.
- **Rationale**: the first packed-lane run surfaced masquerading-as-CJS
  types on three packages, a typeless `engine-v2` subpath, and node16
  resolution errors on two more — all invisible to `workspace:*` consumers.
  node16+bundler covers every supported consumer (Vite, Next/webpack,
  modern tsc); gating on node10 would force `typesVersions` legacy plumbing
  with no consumer demanding it.
- **Alternatives considered**: `attw --profile strict` including node10
  (rejected — legacy-resolution support is a claim no fixture backs, per
  NS3); ignoring attw failures and gating on publint only (rejected — the
  engine-v2 no-types defect is exactly the class the lane exists to catch).

## North Star

**Adversarial cadence K**: 3

- **NS1**: Every public support claim corresponds to a reproducible contract
  keyed on host + version + execution mode + package form, plus engine while
  v1 and v2 coexist.
- **NS2**: The release gate contains the exact blocking package and consumer proof set — lint, Rust hygiene, core verify, Next, Vite, and packed-artifact verification. Remote deployment canaries remain nonblocking operational evidence.
- **NS3**: Evidence precedes claims: peer ranges, docs, and matrix entries
  derive from green fixtures, never aspiration.
- **NS4**: A single-runner packed lane counts as distribution proof —
  provisional — revisit when `external:platform-install-failure-report` occurs
  or the platform-matrix work begins.
- **NS5**: Semantic equivalence lives in the parity harness; distribution
  proof lives in the packed lane; consumer fixtures exercise the intended
  default engine only.

## Decision Ledger

| ID    | Decision                                                                 | Status   | Owner increment                          | Resolving signal                                                                                     | Review-by                    |
| ----- | ------------------------------------------------------------------------ | -------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------- |
| DEF-1 | v2 binary distribution form (fat main tarball vs per-platform packages) | deferred | external:v2-distribution-change-proposal | `verify:packed` receipt documenting actual tarball contents + size (produced by increment 02)         | 3 reorientations \| 2026-09-01 |
| DEF-2 | React 19 peer claim in `system` (earn via fixture vs clamp to `^18`)     | deferred | external:react-19-fixture-lane           | a blocking fixture runs React 19 green, or a consumer-reported React 19 breakage                      | 3 reorientations \| 2026-10-01 |
| DEF-3 | Packed-lane installer breadth (add bun/pnpm/Yarn sentinels)              | deferred | external:package-manager-matrix-change   | packed lane green and stable across 3 consecutive releases                                            | 3 reorientations \| 2026-10-01 |
| DEF-4 | Alternate-engine sentinels in consumer fixtures (whether/which)          | deferred | external:engine-sentinel-selection       | first engine-specific consumer regression that `verify:parity` + `verify:packed` both missed          | 3 reorientations \| 2026-09-01 |
| DEF-5 | node16-resolvable ESM declarations for `properties`/`system` (extensioned or bundled dts emit) | deferred | external:typescript-toolchain-dts-emit-change | a typescript-toolchain change lands extensioned/bundled declaration emit (tsgo `nodenext` emit or dts bundling), making `attw --profile node16` from-ESM green for both packages | 3 reorientations \| 2026-10-01 |

## Guardrail Register

| ID  | Invariant                                                                                                                                                          | Scope      | On trip | Status                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ------- | --------------------------------------------------------------- |
| G1  | The release job SHALL NOT gate on fewer than the full blocking set (blind spot: checks the `needs:` line only, not job-internal `if:` skips)                        | all        | STOP    | active (recalibrated 2026-07-14 post-inc-03: six job ids — passes) |
| G2  | The packed consumer SHALL NOT resolve any `@animus-ui/*` package from the workspace (blind spot: symlink check only; a registry-fetched stale version needs the version assertion in the lane itself) | inc:02     | STOP    | armed(inc 02)                                                    |
| G3  | Plugin peer ranges SHALL NOT contain an open-ended `>=` for `vite`, `next`, or `webpack` (blind spot: does not validate the clamped range against fixture manifests — the lane's receipt does; webpack added post-review, inc 04+05) | all        | STOP    | active (recalibrated 2026-07-14 post-inc-04: empty — passes)      |
| G4  | `verify:packed` SHALL NOT silently rebuild upstream artifacts — missing preconditions produce `ERROR: X missing. Run: Y`                                            | change-end | STOP    | armed(inc 02)                                                    |
| G5  | New surfaces SHALL NOT land without their root `CLAUDE.md` tier-table and Change-Type Map rows                                                                      | change-end | WARN    | active (recalibrated 2026-07-14 post-inc-05: 4 matches — passes) |

Checks — verbatim commands, one fenced block per row:

**G1** — expected after inc 03: the `needs:` array contains `lint`,
`hygiene-rust`, `verify`, `verify-next`, `verify-vite`, `verify-packed`
(calibrated 2026-07-14: currently `needs: verify`)

```bash
rg -n "^  release:" -A 2 .github/workflows/ci.yaml
```

**G2** — expected: empty output (no symlinks into the workspace)

```bash
find e2e/packed-app/.staging/node_modules/@animus-ui -maxdepth 1 -type l 2>/dev/null
```

**G3** — expected after inc 04: empty output (calibrated 2026-07-14:
originally 2 matches — `vite: ">=5.0.0"`, `next: ">=14.0.0"`; webpack added
to the pattern after the inc 04+05 review; recalibrated post-clamp: empty)

```bash
rg -n '"(vite|next|webpack)": ">=[0-9.]+"' packages/vite-plugin/package.json packages/next-plugin/package.json
```

**G4** — expected: exit non-zero with an `ERROR: ... Run:` line, no rebuild
triggered

```bash
mv packages/system/dist packages/system/dist.bak && (vp run verify:packed; echo "exit=$?") ; mv packages/system/dist.bak packages/system/dist
```

**G5** — expected after inc 05: at least 2 matches (tier table row +
Change-Type Map row); calibrated 2026-07-14: 0 matches

```bash
rg -c "verify:packed" CLAUDE.md
```

## Risks / Trade-offs

- [Risk] Packed install resolves `@animus-ui/*` transitives from the public
  registry (stale published versions) instead of local tarballs → Mitigation:
  `overrides` block in the consumer manifest + in-lane assertion that every
  installed `@animus-ui/*` version equals the packed version (G2 covers the
  symlink half).
- [Risk] `bun pm pack` workspace-specifier rewriting diverges from
  `scripts/release.sh`'s version-resolution step, so the lane proves a tarball
  the release never ships → Mitigation: in-lane assertion that no tarball
  manifest contains `workspace:`; follow-up alignment if receipts diverge
  (feeds DEF-1's receipt too).
- [Risk] CI wall-clock grows (two consumer builds + packed lane per push) →
  Mitigation: lanes parallelize against `verify` off shared `build-extract`
  artifacts; revisit trigger scope at a reorientation if added wall-clock
  exceeds ~10 minutes.
- [Risk] Peer clamp breaks installs for consumers already on unproven majors
  → Mitigation: packages are 0.x; call the clamp out in release notes; a
  major can be earned back by adding a blocking fixture (NS3).
- [Trade-off] Packed lane proves native loading on the runner platform only →
  acceptable: platform matrix is explicitly deferred (NS4, provisional).
- [Trade-off] Next 14 support claim dropped without a deprecation cycle →
  acceptable: the claim was never evidence-backed; consumers on 14 keep older
  plugin versions.

## Migration Plan

Land order (each step independently revertable):

1. Packed consumer template + `verify:packed` tier, local-only
   (`vite.config.ts` + scripts + `e2e/packed-app/`).
2. CI jobs for `verify:next`, `verify:vite`, `verify:packed` (non-gating
   first — visible but not in `release.needs`).
3. Flip the gate: expand `release.needs` to the full set (G1 goes green).
4. Peer-range clamps in the two plugin manifests (G3 goes green).
5. `CLAUDE.md` tier-table + Change-Type Map rows (G5 goes green).

Rollback: revert the `release.needs` line (step 3) or individual jobs; the
packed lane is additive and can be disabled by dropping its CI job without
touching the task graph. Acceptance: full gate green on `main`, `verify:packed`
green locally and in CI, guardrails G1/G3/G5 pass their expected-state checks.
