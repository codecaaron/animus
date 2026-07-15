# Design: extract-v2-default-flip

## Context

The archived `2026-07-13-extract-v2-spine` change delivered a
parity-proven v2 extraction engine (47-unit differential green both dev
modes; vite-app + showcase dists byte-identical across engines; next-app
extracted CSS byte-identical; DEF-7: uncached v2 re-analysis beats v1's
cache-hit path). Showcase already runs v2 by user directive. CI builds
`napi-v2-<target>` artifacts. What does NOT exist: a published binary
behind the `./engine-v2` npm export, and v2 as anyone's default.
Downstream change `extract-quirk-shed` depends on this one shipping.

## Goals / Non-Goals

**Goals:** ship the v2 binary in the npm package; flip plugin + fixture
defaults to v2 (config-reversible); decide the A3 transform-source
residue; retire interim dual-engine scaffolding.

**Non-Goals:** deleting v1 or porting `loadSystemModule` (quirk-shed's
final increment); fixing any registered quirk (quirk-shed); changing
plugin APIs beyond the default value.

## Decisions

### D1 — Ship-and-flip is one release event
**Choice:** the same increment that adds the v2 binary to the package
flips the plugin defaults.
**Rationale:** DEF-13 resolution (spine close-out): an unshipped export
is harmless, a shipped-but-non-default binary is dead weight; splitting
them creates a release in-between state nobody tests.
**Alternatives:** ship-then-flip in separate releases — rejected: doubles
release ceremony for an untested intermediate.

### D2 — Escape hatch outlives the flip
**Choice:** `engine: 'v1'` and `ANIMUS_ENGINE=v1` remain functional until
v1 retires (quirk-shed).
**Rationale:** reversibility is the flip's safety property; the
differential harness needs live v1 anyway.
**Alternatives:** hard flip — rejected while v1 is the oracle.

### D4 — A3 residue accepted-and-documented (resolves DEF-1)
**Choice:** v2 `transformFile` emits from analyze-time sources; an
upstream plugin transform between hooks is reverted, guarded by
warn-only drift detection in both adapters. Engine-level
transform-time-source support is deferred until a real consumer trips
the drift warning.
**Rationale:** emitting from analyze-time facts is v2's architectural
win (no transform-time re-parse); the exposure is narrow (only
mid-chain rewrites of animus-relevant source between hooks) and
config-reversible via D2. Resolved at increment 02's review
(2026-07-13), the ledger's designated alternate signal.
**Rider:** the drift warning latches once per process (first drifted
file only — vite closure `v2DriftWarned`, next module-level flag,
duplicated per ESM/CJS instance). A thin tripwire; recorded so the
future consumer-trip signal's weakness is known.

### D5 — Release window: shipped as the 2026-07-13 apply (resolves DEF-3)
**Choice:** the ship-and-flip release event is the first tagged release
carrying this change; the user scheduled it by directing the apply on
2026-07-13 (journal `signal` 02:59).

### D3 — Scaffolding retirement is scoped to provably-dead surfaces
**Choice:** retire the archived change-local tools (subsumed by the
3-leg tier) and the `index-v2.js` fail-loud Proxy (every surface it
guarded is implemented). Keep everything the harness or plugins touch.
**Rationale:** the spine's entropy audit named these retire-candidates;
nothing else is dead yet.

## North Star

- NS1: a consumer upgrading the package observes NOTHING except faster
  dev loops; every step is config-reversible until v1 is deleted.
- NS2: the differential harness is never weakened — it guards
  quirk-shed next. `provisional — revisit when extract-quirk-shed's
  final increment inverts the oracle.`
- NS3: release-seam failures are loud: a partial binary matrix blocks publication, and the V2 loader reports an actionable missing-binary error rather than silently falling back to V1.

Adversarial cadence K: 2

## Decision Ledger

| ID | Decision | Status | Owner increment | Resolving signal | Review-by |
| --- | --- | --- | --- | --- | --- |
| DEF-1 | A3 residue: v2 transformFile emits from analyze-time sources (upstream transform between hooks is reverted; warn-only in both adapters). Accept-and-document vs engine transform-time-source support | resolved → D4 (2026-07-13, inc 02 review) | 02 | first consumer plugin ordering that trips the drift warning, OR the flip increment's review — whichever first | 2 reorientations \| 2026-08-15 |
| DEF-2 | `loadSystemModule` port vs extraction (stays a v1 NAPI call post-flip) | deferred | change:extract-quirk-shed#07 | v1 retirement forces port-or-extract | 3 reorientations \| 2026-10-01 |
| DEF-3 | Release timing: when the ship-and-flip release event happens (D1: one event) | resolved → D5 (2026-07-13, user-directed apply) | 01 | external:release-window — the user schedules the release | 3 reorientations \| 2026-09-01 |

## Guardrail Register

| ID | Invariant | Scope | On trip | Status |
| --- | --- | --- | --- | --- |
| G1 | SHALL NOT weaken verify:parity: all 5 invocations remain | all | STOP | calibrated 2026-07-13: count=6 (5 legs + tier comment line), gate PASS |
| G2 | SHALL NOT remove v1 or its loader (oracle + system-loading roles) | all | STOP | calibrated 2026-07-13: both present |
| G3 | SHALL NOT publish a package whose `./engine-v2` export cannot load | change-end | STOP | defined; runs at the release increment (postpack smoke) |
| G4 | SHALL NOT break the `ANIMUS_ENGINE=v1` escape hatch on any fixture | inc:02 | STOP | calibrated 2026-07-13: v1 builds green on all three fixtures |

```bash
# G1 — expected: >=5 matches AND final line "PARITY GATE: PASS"
rg -c 'cli.ts|seam-battery' scripts/verify/parity.sh
bash scripts/verify/parity.sh | tail -1
```

```bash
# G2 — expected: exit 0
test -f packages/extract/index.js && test -f packages/extract/src/lib.rs && rg -q 'load_system_module' packages/extract/src/lib.rs
```

```bash
# G3 — expected: both requires succeed from the packed tarball (run at release increment)
cd packages/extract && bun pm pack --destination /tmp/animus-pack && mkdir -p /tmp/animus-pack-test && tar -xzf /tmp/animus-pack/*.tgz -C /tmp/animus-pack-test && cd /tmp/animus-pack-test/package && bun -e "require('./index.js'); require('./index-v2.js'); console.log('both engines load')"
```

```bash
# G4 — expected: three green builds
ANIMUS_ENGINE=v1 bash scripts/verify/build-vite.sh && ANIMUS_ENGINE=v1 bash scripts/verify/build-showcase.sh && ANIMUS_ENGINE=v1 bash scripts/verify/build-next.sh
```
