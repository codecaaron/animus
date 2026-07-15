<!--
brainstorm.md — the STRATEGIC exploration record for the whole change.

HISTORICAL RECORD: immutable once design.md exists; design.md supersedes this
file on any conflict. An append-only exploration log is valuable; a second
live copy of the decision state is not — never sync this file after design.md
lands.
-->

# release-truth-v1 — Exploration Record

## Evidence citation (exploration already performed — skill skipped)

This change was scoped through three pre-existing bodies of evidence, captured
in the 2026-07-14 planning conversation:

1. **External maturity audit** (user-supplied): identified P0 gaps — GitHub
   release gate narrower than local `verify:ci`; fixtures consume workspace
   packages, never packed tarballs — plus P1/P2 items (Turbopack, source maps,
   platform coverage, peer-range over-claim). Proposed three strategies (logo
   matrix / compiler fortress / contract pyramid) and recommended the contract
   pyramid.
2. **Repo verification** (this session, receipts below): every load-bearing
   claim in the audit was checked against the working tree and confirmed; one
   new finding (engine packaging asymmetry) was discovered in the process.
3. **User's revised first increment** (authoritative scope statement): five
   numbered points — unify the release gate; add `verify:packed`; clamp peer
   ranges to evidence; treat engine as a compatibility dimension; sequence
   compiler-fortress work behind the v2 default flip.

## KNOWN-NOW (verified against the working tree, 2026-07-14)

- **Release gate is narrower than local `verify:ci`.** In
  `.github/workflows/ci.yaml`, the `release` job has `needs: verify` only
  (line 216). `verify` covers compile/types/unit:ts/canary/parity/integration/
  **showcase only**. `lint` and `hygiene-rust` are parallel jobs that do NOT
  gate release. `verify:next` and `verify:vite` are absent from CI entirely,
  though both tiers exist in the task graph (`vite.config.ts:427,437`).
- **All e2e fixtures consume `workspace:*`** (`e2e/next-app/package.json`,
  `e2e/vite-app/package.json`). Nothing exercises packed tarballs, exports
  maps, `files` whitelists, platform-package resolution, or published types.
- **Fixture version evidence**: Vite **8.1.4** (vite-app, showcase), Next
  **15.5.20 webpack** (next-app), React **18** everywhere. Nothing older or
  newer is proven.
- **Peer ranges over-claim**: `vite-plugin` peers `vite: ">=5.0.0"`;
  `next-plugin` peers `next: ">=14.0.0"`. Both are open-ended and include
  majors with no fixture (including Next 16 Turbopack, known-unsupported).
  `system` peers `react: "^18.0.0 || ^19.0.0"` — the `^19` half is unbacked
  (noted; out of scope here).
- **Engine defaults**: both plugins default to v2 —
  `packages/vite-plugin/src/index.ts:237` (`options.engine ?? 'v2'`) and
  `packages/next-plugin/src/singleton.ts:93` (`|| 'v2'`). v2 resolves via the
  `@animus-ui/extract/engine-v2` subpath. Showcase flipped to v2 default
  2026-07-13 (recorded in ci.yaml comment, line 171).
- **Engine packaging asymmetry (new finding)**: v1 binaries ship as
  per-platform `optionalDependencies` (`@animus-ui/extract-darwin-arm64`,
  `-linux-x64-gnu`, `-linux-arm64-gnu`); v2 binaries ship via
  `crates/extract-v2/*.node` globbed into the **main tarball's** `files`
  (`packages/extract/package.json:23-29`). The release job downloads all
  three platform v2 binaries before publish → `@animus-ui/extract` ships fat
  for v2, lean-per-platform for v1. The `*.node` glob also sweeps any
  locally-built v1 binary into the main tarball.
- **Source maps**: the Vite boundary returns `map: null`
  (`packages/vite-plugin/src/index.ts:1308`).
- **Native targets built in CI**: darwin-arm64, linux-gnu x64/arm64 only.
- **Five publishables**: `properties`, `system`, `extract`, `vite-plugin`,
  `next-plugin`.

## DEFERRED (each with its resolving signal)

- **Windows / musl / Intel-mac native targets** — signal: `verify:packed`
  green and stable, plus a named consumer on that platform (or an
  install-failure report). Single-runner packed lane is accepted as
  distribution proof until then.
- **Package-manager matrix beyond bun/npm** — signal: packed lane green for
  several releases; pnpm/Yarn/Yarn-PnP each become their own capability lane.
- **Browser/Playwright conformance (cascade, hydration, HMR cycles, CSP)** —
  signal: v2 default everywhere and the first increment's gates stable.
- **Next 16 Turbopack support** — signal: a blocking fixture exercising the
  exact mode (Turbopack build) exists and is green. Until then the peer range
  excludes Next 16. A peer range cannot distinguish Next 16 Turbopack from
  `next build --webpack`, so exclusion is the honest default.
- **React 19 peer claim in `system`** — signal: one fixture flipped to React
  19 (cheap follow-up, separate change). Until then the claim is unbacked but
  left untouched (out of scope).
- **Fuzzing, stable IR schemas, performance budgets, `animus doctor`** —
  signal: v2 is default everywhere and v1 retirement is decided. Building
  compiler-fortress tooling against v1 is throwaway; against a mid-transplant
  v2 it targets a moving surface. Exception: parity-corpus growth serves both
  eras and proceeds now.
- **Source-map propagation** — handled as v2 boundary correctness with a
  contract test in the v2 workstream, NOT as a compatibility-matrix project
  here. Signal: v2 boundary work active.
- **Vinext / React Router lanes** — outside the first gate; signal: named
  host demand.
- **v2 fat-tarball vs per-platform distribution decision** — signal:
  `verify:packed` output documents actual tarball contents and size; decide
  in a follow-up change with that receipt in hand.
- **Machine-readable conformance matrix rendering** — signal: gates emit
  structured results (this change's engine/package-form recording is the
  precursor). Rendering is ~a day once evidence exists; worthless before.

## Candidate NORTH STAR criteria

- **Support claims are reproducible contracts** keyed on
  *host + version + execution mode + package form*, plus an **engine**
  dimension while v1 and v2 coexist.
- **The release gate is a superset of every consumer-facing proof that
  exists.** No publishable artifact ships without every existing blocking
  lane green.
- **Evidence precedes claims.** Peer ranges, docs, and matrix entries derive
  from green fixtures — never aspiration. (Provisional corollary: a
  single-runner packed lane counts as distribution proof for now; revisit on
  the first platform-specific install failure or when the platform matrix
  lands.)
- **Semantic equivalence lives in the parity harness; distribution proof
  lives in the packed lane.** Consumer fixtures exercise the intended default
  engine plus strategically chosen alternate-engine sentinels — not every
  host × engine cross-product.

## Candidate GUARDRAILS (negative invariants + executable check sketches)

- **The release job SHALL NOT run without the full gate.** Check: assert in
  CI review (or a hygiene grep) that `release.needs` in ci.yaml includes
  lint, rust hygiene, verify, and the next/vite/packed lanes.
- **`verify:packed` SHALL NOT resolve any `@animus-ui/*` package from the
  workspace.** Check: in the packed consumer, assert no
  `node_modules/@animus-ui/*` entry is a symlink into `packages/`
  (`test ! -L` per package) and that installed versions match the packed
  tarball versions.
- **Peer ranges SHALL NOT include a major with no blocking fixture.** Check:
  script comparing each plugin's peer-range majors against the majors
  actually installed in blocking fixtures' manifests.
- **The packed lane SHALL NOT pass with a missing engine.** Check: explicit
  load of BOTH engine entrypoints (`@animus-ui/extract` and
  `@animus-ui/extract/engine-v2`) from the packed install, hard-failing if
  either is unresolvable or its binary is absent.
- **`verify:packed` SHALL NOT silently rebuild upstream.** Check: follows the
  repo-wide atomic-tier rule — missing prerequisites produce
  `ERROR: X missing. Run: Y` (existing tier convention; test by deleting a
  dist and asserting the error message).
- **No new surface without a Change-Type Map row.** Check: root `CLAUDE.md`
  ownership rule — the same change that adds `verify:packed` (and any packed
  consumer fixture) adds its rows.

## Decision chain

1. The external audit's two P0s were **verified, not assumed** — and the
   release-gate P0 turned out *understated*: lint/hygiene don't gate release
   either, and Next/Vite lanes are absent from CI entirely.
2. **Contract pyramid** chosen over logo matrix (maintenance treadmill) and
   compiler fortress (leaves install/native/types failures unproven — the
   failure modes consumers hit first).
3. The audit's four-program plan was judged **~4× too large** for a first
   increment; scope narrowed to what ships in ~1–2 weeks and reuses existing
   assertion infrastructure.
4. **Sequencing anchored on the v2 transplant in flight** (showcase default
   flipped 2026-07-13): contract infrastructure is engine-agnostic and
   derisks the flip → build now; compiler-fortress work would target a moving
   or doomed surface → defer behind the flip.
5. **Peer-range clamp promoted from the audit's P2 to this increment**: it is
   the cheapest honesty fix and converts doc drift into an install-time
   signal.
6. **Engine added as an explicit compatibility dimension** after the
   packaging-asymmetry discovery showed v1 and v2 differ not just in default
   but in *distribution mechanism* — so "package form" varies per engine and
   must be recorded per result.
7. User issued the revised five-point increment (2026-07-14), which is the
   authoritative scope for this change.
