# Increment 07: publish-manifest-hygiene

## Scope

- **Registry row**: 07 · mode: delegate · review: subagent
- **Resolves**: D7 (supported type-resolution matrix for published artifacts)
- **Authors**: — (envelope: §packed-consumer-verification/Tarball export and
  type lint is the governing requirement; no new spec text owed)
- **Depends on (ordering — deps:)**: none (spawned from inc 02's first lane
  run; inc 02's green gate waits on this row)
- **Inputs from (information — inputs:)**: none (the finding set is embedded
  below)
- **Footprint**: `packages/properties/package.json`,
  `packages/system/package.json`, `packages/extract/package.json`,
  `packages/vite-plugin/package.json`, `packages/next-plugin/package.json`,
  `packages/*/tsdown.config.*`, `packages/extract/index-v2.d.ts` (new file),
  `scripts/verify/_preconditions.sh` (probe-candidate list only)
- **Pushes to a later increment**: none

> Resolving signal: journal `spawn` entry 2026-07-14 20:28 (inc 02's first
> `verify:packed` run produced the publint/attw finding set below).

## Context Capsule

- **Objective**: All five publishable tarballs pass `bunx publint --strict`
  (exit 0) and `bunx attw --profile node16` (exit 0). Published declaration
  files match their runtime format per export condition; every supported
  subpath resolves with types under node16 (ESM+CJS) and bundler modes.
  node10 is out of contract (D7).
- **The finding set** (from `bun pm pack` tarballs of the current tree):
  - `@animus-ui/next-plugin`: publint --strict ERROR — `exports["."].types`
    is CJS-interpreted under the `import` condition (runtime `.mjs`, types
    `.d.ts`, package has no `type` field). attw: root "Masquerading as CJS"
    from ESM; `./loader` — node16-from-CJS "Incorrect default export",
    from-ESM "Masquerading as CJS".
  - `@animus-ui/vite-plugin`: NO `exports` map at all (`main`/`module` =
    `./dist/index.mjs`, `types` = `./dist/index.d.ts`). attw: "Masquerading
    as CJS" both node16 modes.
  - `@animus-ui/extract`: root is fine (CJS-only, sibling `index.d.ts`,
    all green). `./pipeline` (`dist/index.mjs` + `types: dist/index.d.ts`):
    "Masquerading as CJS" + `require` condition points at an `.mjs`.
    `./engine-v2` (`index-v2.js`, CJS): **No types** in ANY mode —
    `index-v2.d.ts` does not exist and nothing type-shaped ships for it,
    though napi-generated declarations DO exist at
    `packages/extract/crates/extract-v2/index.d.ts`.
  - `@animus-ui/properties`: attw "Internal resolution error" in both
    node16 modes (ESM-only package, `exports["."]` = types/import/default).
    Diagnose with `bunx attw <tarball> --format json` before changing
    anything — an attw-internal crash may need an `--ignore` or a manifest
    nudge; understand it first.
  - `@animus-ui/system`: root and most subpaths green; `./runtime` fails
    node10 (out of contract — ignore) and hits the same node16 "Internal
    resolution error". Same diagnose-first instruction.
- **Proven-good in-repo patterns** (copy these, don't invent):
  - CJS-only surface: `extract` root — no `type` field, `main: index.js`,
    sibling `index.d.ts`, exports conditions all → the same CJS file, and
    NO `types` condition (TS sibling-substitution supplies types). attw
    fully green.
  - ESM-only surface: `system` root — `"type": "module"`, `dist/index.js`
    + `dist/index.d.ts` (ESM-flavored via the type field), exports with
    `types` + `import`. Green under node16+bundler.
- **Hard constraints**:
  - **Bun ≥1.3.12 `createRequire` bug** (root CLAUDE.md § Key Rules): a
    `types` export condition can be matched as RUNTIME by bun's
    createRequire, loading `.d.ts` as JS. `@animus-ui/extract`'s root and
    `./engine-v2` are consumed via CJS `require` from bun contexts — do
    NOT add a `types` condition to `extract`'s `"."` or `"./engine-v2"`.
    Use the sibling-declaration pattern instead: create
    `packages/extract/index-v2.d.ts` re-exporting the napi declarations
    (`export * from './crates/extract-v2/index';` — verify the exact
    relative specifier resolves in a quick `tsc --noEmit` probe) and add
    `"index-v2.d.ts"` and `"crates/extract-v2/index.d.ts"` to the
    `files` array.
  - Declaration emit stays on tsgo (`build:ts` = `tsdown && tsgo -p
    tsconfig.build.json`, tsdown `dts: false` in
    `tsdown.config.base.ts`) — do NOT flip dts emission to tsdown; that is
    a repo-wide toolchain decision (typescript-toolchain capability) above
    this increment's authority. Work with manifests, package `type`
    fields, tsdown `format`/output extensions, and shim files.
  - If you change any dist entry filename (e.g. a package's tsdown format
    from esm→cjs produces `dist/index.cjs`), update the probe candidates
    in `require_fresh_package_dist` in `scripts/verify/_preconditions.sh`
    (currently probes `dist/index.mjs` then `dist/index.js`) — keep the
    fail-loud message shape.
  - Suggested (not mandated) repairs, chosen to match the proven patterns:
    vite-plugin → `"type": "module"` + proper exports map (mirrors system);
    next-plugin → CJS-only output (mirrors extract root; its consumers are
    `next.config.ts` ESM imports, which interop fine with statically
    analyzable CJS named exports, and webpack's CJS loader require);
    extract `./pipeline` → either CJS-only output or a correctly-flavored
    ESM declaration — judge by what attw accepts.
- **In-scope guardrails**: none from the Register (the lane itself is the
  check); the acceptance commands below are the gate.
- **In-scope North Star criteria**: NS1, NS3 (claims match shipped
  artifacts).
- **Prohibitions**: no version-control mutations; no writes outside the
  declared footprint plus this file; never write to design.md, tasks.md,
  journal.md, or specs/; do not touch `e2e/packed-app/**`,
  `scripts/verify/packed.sh`, `vite.config.ts`, `.github/**`, or root
  `package.json` (other increments' territory).

## Plan

## Task 07.1: Diagnose the two internal resolution errors

- [x] **Step 1:** Re-pack current tarballs if absent:
  `cd packages/properties && bun pm pack --destination /tmp/attw-probe` (and
  likewise system), then run
  `bunx attw --format json /tmp/attw-probe/<tarball>.tgz | head -100` for
  properties and system. Record the exact failing resolution and why.
  Decide: manifest fix, or (if attw-internal) a documented
  `--ignore-rules` justification — prefer the fix.

  **Diagnosis (verbatim):** Both errors are the SAME root cause and are NOT
  attw-internal crashes — they are genuine `InternalResolutionError`s. The
  repo's `tsconfig.json` sets `moduleResolution: "bundler"` + `module:
  "esnext"`, so `tsgo` emits *extensionless* relative specifiers in every
  `.d.ts` (e.g. properties `dist/index.d.ts` → `export { SHORTHAND_PROPERTIES }
  from './shorthands'`; system `dist/index.d.ts` → 23 lines re-exporting
  `./Animus`, `./compose`, `./runtime`, `./runtime/createClassResolver`,
  `./types/config`, …). Because both packages set `"type": "module"`, those
  `.d.ts` files are ESM-flavored, and node16-ESM resolution requires an
  explicit `.js` extension (and rejects directory-index like `./runtime`) — so
  every extensionless/directory specifier fails to resolve (`attw --format
  json` trace: "Directory '…/dist/shorthands' does not exist, skipping all
  lookups" → "was not resolved"). The tsdown-emitted *runtime* (`dist/index.js`)
  carries `.js` extensions (`from "./compose.js"`) and resolves fine, so it is a
  pure types-vs-runtime skew. Both packages additionally show
  `CJSResolvesToESM` under node16-from-CJS. **Both are blocking under `attw
  --profile node16`** (confirmed by isolating each rule). The fix is NOT
  `--ignore-rules` (the failures are real for node16/nodenext consumers); it
  requires extensioned or bundled ESM declarations — see Output contract for
  why that is out of this increment's footprint.

## Task 07.2: Repair each package

- [x] **Step 1:** `@animus-ui/next-plugin` — apply the chosen repair
  (suggested: CJS-only). Update `tsdown.config.ts` format, `main`/`module`/
  `types`, and the exports map so every condition's runtime and types agree
  in format; fix `./loader`'s default-export shape the same way.
  **Done — CJS-only main:** dropped the `import`/`.mjs` condition and the
  `module` field so `.` resolves to the CJS `index.cjs` with its CJS-flavored
  `.d.ts`. Removed the `./loader` subpath from `exports` entirely — it is an
  internal webpack loader loaded by absolute path (`resolve(__dirname,
  'loader.mjs')` in `with-animus.ts`), no consumer imports the subpath, and
  keeping it exported forced an unfixable `.d.mts`/`.d.cts` flavor split. tsdown
  kept `format: ['esm','cjs']` so `loader.mjs` is still emitted for that
  runtime path reference. attw + publint green.
- [x] **Step 2:** `@animus-ui/vite-plugin` — add the exports map (suggested:
  `"type": "module"` route); keep the animusExtract named export surface
  identical. **Done — CJS-only (deviates from the ESM suggestion):** a pure-ESM
  package cannot pass `attw --profile node16` (node16-from-CJS always reports
  the blocking `CJSResolvesToESM`; proven with scratch fixtures). As a
  build-time Node tool whose declaration is self-contained, CJS is the correct
  green shape: `tsdown format: ['cjs']` → `dist/index.cjs`, exports `{ types,
  default }`, `animusExtract`/`discoverFiles`/default surface unchanged and
  statically analyzable. attw + publint green; `verify:vite` green.
- [x] **Step 3:** `@animus-ui/extract` — fix `./pipeline` flavor mismatch;
  create `index-v2.d.ts` sibling shim; extend `files` (see constraints —
  NO types conditions on `"."`/`"./engine-v2"`).
  **Done:** `./pipeline` → dual `format: ['esm','cjs']`, exports point at the
  CJS `dist/index.cjs` (clears the masquerade); the `.mjs` is still emitted
  because `tests/canary.test.ts` requires `../dist/index.mjs` by path (outside
  footprint). `index-v2.d.ts` created as a sibling shim with NO `types`
  condition; typed as `export =` of the napi namespace with the value opaque
  (`unknown`) + type-only members — declaring the napi functions as named value
  exports made attw report "Named exports" because the hand-written
  `index-v2.js` does `module.exports = loadNative()` (opaque to cjs-lexer).
  `files` extended with `index-v2.d.ts` and `crates/extract-v2/index.d.ts`. All
  three extract entrypoints attw-green; publint green.
- [x] **Step 4:** `@animus-ui/properties` + `@animus-ui/system` — apply the
  Task 07.1 diagnosis. **BLOCKED within footprint — left coherent (properties
  reverted to its original ESM manifest; system untouched).** Both are
  genuinely ESM-only for real consumers: properties is bundled + evaluated as
  an ES module by the Rust `system-loader` (rquickjs) during `loadSystemModule`
  (a CJS properties fails `verify:canary` with "exports is not defined"); system
  is the primary React design-system whose ESM/`sideEffects:false` tree-shaking
  is load-bearing. The only footprint-legal green shape (CJS-only) is therefore
  unavailable to them, and their extensionless ESM declarations (Task 07.1)
  cannot be repaired via manifest/tsdown alone. See Output contract for the
  required out-of-footprint fix.
- [x] **Step 5:** Rebuild all dists: `bunx vp run build:ts` — expected exit 0.
  **Done — exit 0** (all workspaces "Exited with code 0").

## Task 07.3: Acceptance

- [x] **Step 1:** For each of the five packages:
  `(cd packages/<p> && bunx publint --strict --pack bun)` — expected exit 0
  for ALL five (suggestions tolerated; errors not).
  **PASS — 5/5 exit 0** (properties, system, extract, vite-plugin, next-plugin).
- [~] **Step 2:** Pack fresh tarballs (`bun pm pack --destination
  /tmp/attw-final` per package) and run
  `bunx attw --profile node16 /tmp/attw-final/<tarball>` per package —
  expected exit 0 for ALL five.
  **PARTIAL — 3/5 exit 0:** extract, vite-plugin, next-plugin → exit 0.
  properties + system → exit 1 (BLOCKED within footprint; Task 07.1 diagnosis +
  Output contract).
- [x] **Step 3:** Regression fast gate: `bunx vp run verify:compile &&
  bunx vp run verify:unit:ts && bunx vp run verify:canary` — expected exit 0
  (canary exercises the NAPI loading contract your manifest edits could
  disturb). **PASS — all exit 0** (compile 0; unit:ts 0, 217/217; canary 0,
  199 pass). Canary caught the two couplings that reshaped this increment (see
  Output contract friction notes).
- [x] **Step 4:** Workspace-consumer smoke: `bunx vp run verify:vite` —
  expected exit 0 (proves the manifest changes didn't break workspace
  resolution for the heaviest ESM consumer). **PASS — exit 0** (vite-app built;
  assert-vite "all assertions passed").

## Guardrail gate

- [~] Acceptance steps 07.3.1–07.3.4 all pass — record each command's final
      status line here.
  - 07.3.1 publint --strict --pack bun: `publint properties/system/extract/
    vite-plugin/next-plugin: exit 0` (5/5 PASS).
  - 07.3.2 attw --profile node16: `attw extract/vite-plugin/next-plugin: exit
    0`; `attw properties: exit 1`; `attw system: exit 1` (3/5 PASS, 2 BLOCKED).
  - 07.3.3 verify:compile && verify:unit:ts && verify:canary: `verify:compile
    exit 0`; `verify:unit:ts exit 0` (Tests 217 passed); `verify:canary exit 0`
    (199 pass, 0 fail) (PASS).
  - 07.3.4 verify:vite: `verify:vite exit 0` ("[vite-app:assert] … all
    assertions passed") (PASS).
  - **Gate status: NOT fully green.** 07.3.1, 07.3.3, 07.3.4 pass. 07.3.2 passes
    for 3/5 packages; properties + system are blocked within this increment's
    footprint (STOP-and-report per the diagnose-first instruction), left in a
    coherent state.

## Output contract (delegate mode)

- [x] Plan checkboxes above ticked to reflect actual completion
- [x] Per-package summary: what changed in each manifest/config and WHY
      (one line each), suitable for the orchestrator's journal
- [x] The Task 07.1 diagnosis verbatim (what the internal resolution errors
      actually were) — see Task 07.1 Step 1 above.
- [x] Acceptance results with final output lines — see Guardrail gate above.
- [x] Proposed journal entries (surprise / friction), 1–3 lines each
- [x] Surfaced variables (spawn candidates), or "none"

### Per-package summary (one line each)

- **@animus-ui/extract** — `./pipeline` → dual esm+cjs, exports the CJS
  `dist/index.cjs` (clears node16 masquerade; `.mjs` retained for the
  canary test's by-path require); new `index-v2.d.ts` sibling shim gives
  `./engine-v2` types with no `types` condition (createRequire bug) and an
  opaque `export =` value to dodge the cjs-lexer "Named exports" mismatch;
  `files` extended with the shim + napi `.d.ts`. → attw + publint green.
- **@animus-ui/vite-plugin** — CJS-only (`tsdown format: ['cjs']`, exports `{
  types, default: index.cjs }`, dropped `module`) because pure-ESM can't pass
  `attw --profile node16` and it is a build-time Node tool. → attw + publint
  green; verify:vite green.
- **@animus-ui/next-plugin** — main → CJS-only (dropped `import`/`module`);
  removed the internal `./loader` subpath from `exports` (webpack loads it by
  absolute path, no subpath consumers); kept `loader.mjs` emitting. → attw +
  publint green.
- **@animus-ui/properties** — reverted to its original ESM manifest (BLOCKED):
  the Rust system-loader evaluates it as an ES module, so CJS-only (the only
  footprint-legal green shape) breaks `loadSystemModule`. → attw exit 1,
  publint exit 0.
- **@animus-ui/system** — untouched (BLOCKED): primary ESM design-system with
  extensionless multi-file declarations; no footprint-legal green shape. →
  attw exit 1, publint exit 0.
- **scripts/verify/_preconditions.sh** — `require_fresh_package_dist` probe now
  also recognizes `dist/index.cjs` (extract/vite-plugin/next-plugin emit it),
  fail-loud message shape preserved.

### Why properties + system are blocked (the load-bearing finding)

`attw --profile node16` requires exit 0, and I proved (scratch fixtures) that a
**pure-ESM package can never pass it**: node16-from-CJS is always either
`CJSResolvesToESM` (⚠️) or `NoResolution` (💀), both blocking. Only two shapes
pass: **CJS-only** (extract-root pattern) or **dual ESM+CJS with a real
CJS-flavored `.d.cts`**. Dual needs a `.d.cts`, which `tsgo` does not emit and
this footprint cannot generate. Separately, any ESM-mode type resolution over
properties'/system's declarations hits `InternalResolutionError` (extensionless
specifiers, Task 07.1). properties and system are both *required* to stay ESM by
real consumers (rquickjs system-loader; design-system tree-shaking), so neither
CJS-only nor dual is available. **The genuine fix is out of footprint:** emit
node16-resolvable ESM declarations — either `moduleResolution: "nodenext"` +
`.js` import specifiers in source, or bundled single-file declarations. Both are
repo-wide `typescript-toolchain` decisions (tsconfig + source, or flipping dts to
tsdown) explicitly excluded from this increment.

### Proposed journal entries

- **Surprise (attw × pure-ESM):** `attw --profile node16` cannot pass for any
  pure-ESM package — node16-from-CJS is always a blocking `CJSResolvesToESM`.
  Green under node16 demands CJS-only or dual-with-`.d.cts`. The packet's "mirror
  system (ESM)" suggestion rested on system root being green under node16, which
  it is not. (via inc 07 subagent)
- **Surprise (blocked pair):** properties + system share one unfixable-here root
  cause — extensionless ESM declarations from `moduleResolution: "bundler"` +
  both are consumer-pinned to ESM (rquickjs system-loader eval; DS tree-shaking).
  The real fix is a `typescript-toolchain` declaration-emit change, above this
  increment's authority. (via inc 07 subagent)
- **Friction (canary caught two couplings):** the first CJS conversion pass broke
  `verify:canary` twice — `canary.test.ts` requires `../dist/index.mjs` by path
  (forced pipeline to stay dual), and CJS properties broke rquickjs
  `loadSystemModule` ("exports is not defined"). Both couplings are invisible to
  publint/attw; only the canary regression gate surfaced them. (via inc 07
  subagent)
- **Friction (engine-v2 loader shape):** the hand-written `index-v2.js`
  (`module.exports = loadNative()`) is opaque to cjs-module-lexer, so shipping
  the real napi named types triggers attw "Named exports"; the green shim is an
  `export =` opaque value with type-only members. (via inc 07 subagent)

### Surfaced variables (spawn candidates)

1. **typescript-toolchain: node16-resolvable ESM declaration emit for
   properties + system** (unblocks the 2/5 attw failures). Requires a repo-wide
   decision: `moduleResolution: "nodenext"` + `.js` import specifiers in source
   `.ts`, OR bundled single-file `.d.ts` (api-extractor/rollup-dts, or flipping
   `dts` to tsdown) — all outside this increment's footprint. This is the gating
   item for a genuine 5/5 `attw --profile node16`.
2. **Orchestrator decision: is `--profile esm-only` acceptable for the ESM
   packages?** properties + system pass `attw --profile esm-only` today (node16-
   from-CJS ignored). If the release contract for ESM-only artifacts is
   esm-only, the acceptance for those two should read `--profile esm-only`; if
   node16 CJS-interop is a hard requirement, variable #1 must land first.
3. **`scripts/verify/packed.sh` (other increment) attw invocation:** must run
   attw from a repo-context cwd (a real `@arethetypeswrong/cli` binary),
   never `bunx attw` from `/tmp` — `bunx attw` outside the repo fetches a
   dependency-confusion placeholder named `attw`. And it must decide how to
   treat the properties/system node16 failures (gate vs. allowlist).

## Spec authorship checklist (orchestrator; the tie-back before ticking)

- [ ] No spec text owed (envelope covers; D7 already recorded in design.md)
- [ ] No Ledger rows to flip
- [ ] Appended accepted journal entries (attributed `via inc 07 subagent`)
- [ ] Reorientation entry written per cadence
- [ ] Ticked registry row 07 in tasks.md with `· ticked: <timestamp>`
