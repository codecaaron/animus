# Brainstorm: extract-v2-default-flip

> **Evidence basis (exploration already happened — captured, not re-run):**
> the archived change `openspec/changes/archive/2026-07-13-extract-v2-spine/`
> — its journal (RF-1..close-out), two per-increment Fable review artifacts
> (inc-07 semantics + gate-integrity, row-13 close-out), the 47-unit
> differential harness (`packages/_parity`, 5-leg `verify:parity`), three
> consumer-oracle results (vite-app + showcase dists BYTE-IDENTICAL across
> engines; next-app extracted CSS byte-identical), DEF-7 timing (v2 uncached
> re-analysis 9.8ms < v1 warm-cache 10.7ms at showcase scale), and one live
> production-of-truth: showcase runs engine v2 by user directive
> (journal 2026-07-13 15:50) including the HMR session that surfaced and
> fixed the empty-source protocol gap (16:40).

## 1. KNOWN-NOW vs DEFERRED

**Known now (evidence-settled):**
- v2 is parity-complete for every surface the plugins consume; the flip is
  a RELEASE event, not an engineering unknown. Shipping the binary and
  flipping defaults must travel together (DEF-13 resolution, spine
  close-out 18:05): an unshipped export is harmless, a shipped-but-
  non-default binary is dead weight.
- CI already builds `napi-v2-<target>` artifacts (spine row-13 review B2
  fix); the release pipeline does NOT yet include them in the npm package
  (`packages/extract/package.json` files array + release workflow).
- The plugins' engine option and adapters are DONE (vite `engineApi`,
  next singleton) — the flip itself is a one-line default change per
  plugin plus fixture-config defaults.
- The interim scaffolding inventory to retire is enumerated: change-local
  tools (code/css/chain-parity — subsumed by the 3-leg tier), the
  `index-v2.js` fail-loud Proxy (obsolete once every surface is
  implemented — it already is), and the `ANIMUS_ENGINE` escape hatches
  (keep until v1 retires).
- v1 CANNOT be deleted in this change: it is the differential oracle the
  quirk-shed change (`extract-quirk-shed`) still needs, AND
  `loadSystemModule` still lives only in v1.

**Deferred (with resolving signals):**
- **A3 residue** — v2 `transformFile` emits from ANALYZE-TIME sources; an
  upstream plugin transform between hooks is reverted (warn-only today,
  both adapters). Decide accept-and-document vs engine support for
  transform-time source. *Resolving signal:* the first real consumer
  plugin ordering that trips the drift warning (fixture dists prove none
  exists today) — OR the flip increment's review, whichever first.
- **`loadSystemModule` port** — stays a v1 NAPI call after the flip.
  *Resolving signal:* v1 retirement increment (quirk-shed change
  completion) forces the port-or-extract decision; until then dual
  binaries ship.
- **v1 removal from the npm package** — *resolving signal:*
  `extract-quirk-shed` archived (v1's oracle role ends) + one clean
  release cycle on v2-default.

## 2. Candidate NORTH STAR criteria

- **A consumer upgrading the package should observe NOTHING** (byte-level
  where the platform allows) except faster dev loops. Every flip step is
  reversible via config until v1 is deleted.
- **The differential harness outlives the flip**: it guards the
  quirk-shed change next; nothing this change does may weaken it
  (provisional — revisit when v1 retires and the oracle inverts to
  v2-vs-committed-baselines).
- **Fail loud on the release seam**: a missing v2 binary in a published
  package must be a hard install/load error, never a silent v1 fallback.

## 3. Candidate GUARDRAILS

- The change SHALL NOT delete or weaken any leg of `verify:parity`.
  *Check:* `scripts/verify/parity.sh` runs 5 invocations; CI greps for
  the three PASS lines.
- The change SHALL NOT remove v1 or `loadSystemModule`. *Check:*
  `test -f packages/extract/index.js` + canary `require` probe in CI.
- The change SHALL NOT publish a package whose `./engine-v2` export
  cannot load. *Check:* postpack smoke — `npm pack` + `require` of both
  exports from the tarball in a temp dir.
- Fixture escape hatches SHALL keep working. *Check:*
  `ANIMUS_ENGINE=v1` build of each fixture in the flip increment's gate.

## 4. Decision chain

DEF-13 (spine ledger) resolved at close-out → distribution rides the flip
(one release event). Spine row-13 review B2 forced CI v2-binary builds,
making the release wiring incremental rather than greenfield. The A3
residue and `loadSystemModule` port were explicitly pushed here by the
row-13 packet ("Pushes to a later increment"). v1 retention ordering
comes from `extract-quirk-shed`'s dependency on the oracle. The two-change
split (flip vs quirk-shed) exists because the flip must be OBSERVABLY
INERT while quirk-shedding is observably corrective — mixing them would
make the "nothing changed" claim unfalsifiable.
