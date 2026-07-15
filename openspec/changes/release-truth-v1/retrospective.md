# Retrospective: release-truth-v1

## 0. Evidence

- **Increments**: 7/7 completed (+1 cross-cutting row). Mode split: 1
  inline (02), 6 delegated (01, 03, 04, 05, 06, 07 — 07 spawned
  mid-flight). One delegate dispatch misfired (04 first attempt, zero tool
  calls) and was re-dispatched clean.
- **Tasks done**: 104 ticked boxes across increments/ + tasks.md; registry
  lint 0 errors / 0 warnings; every `ticked:` timestamp cross-checked to an
  existing journal reorientation (verify §2).
- **Capabilities touched**: 5 — 2 new behavioral
  (`packed-consumer-verification`, `peer-range-policy`), 3 modified
  behavioral (`release-workflow`, `verification-tier-policy`,
  `dual-engine-build`). No arch-* capability authored. 16 requirements in
  the delta tree, all ADDED (zero cross-change collision surface).
- **Guardrails**: 5 registered (G1–G5); 0 runtime STOP trips (G1/G3/G5
  calibrated tripping at registration by design, all now active-passing);
  G2/G4 proven live during inc 02 (G4 via destructive-precondition proof:
  exit 1, no rebuild). Promotion candidates at archive: see §6.
- **Journal**: 34 entries — 1 seed, 6 surprise, 7 friction, 2 signal,
  13 objection, 4 reorientation, 1 spawn, 0 guardrail-trip, 0 mode-change.
- **Deferral outcomes**: DEF-1 resolved-as-predicted (packed lane produced
  the fat-tarball receipt: 4.8M extract tarball, both engines' binaries).
  DEF-5 CREATED mid-flight (not predicted by the envelope) — the packed
  lane's first run surfaced the declaration-emit defect class. DEF-2/3/4
  remain deferred, unbreached, owners and review-by dates intact.
- **Delegation outcomes**: 7 dispatched implementers (6 rows + 1 re-dispatch),
  4 reviewer passes, 1 independent verifier — 11 successful merges, 1
  rejected/retried (the 04 misfire), 0 output contracts rejected for
  non-conformance. All merges honored the single-writer rule (verify §12).
- **Files touched** (from increment footprints): `.github/workflows/ci.yaml`,
  `vite.config.ts`, `scripts/verify/packed.sh` (new),
  `scripts/verify/_preconditions.sh`, `scripts/assert-showcase-build.ts`,
  `e2e/packed-app/**` (new fixture), `e2e/{vite,next}-app/scripts/assert-build.ts`,
  `packages/{properties,system,extract,vite-plugin,next-plugin}/package.json`,
  `packages/*/tsdown.config.ts`, `packages/extract/index-v2.d.ts` (new),
  `packages/_assertions/src/receipt.ts` (new) + index + test, root
  `package.json`/`bun.lock`/`.gitignore`, `CLAUDE.md`, `CHANGELOG.md`.
- **New external dependencies**: `publint`, `@arethetypeswrong/cli`
  (root devDeps).
- **Validate state**: targeted `openspec validate release-truth-v1` valid;
  repo-wide shows 4 unrelated failing changes (no collisions).
- **Test signal**: `verify:lint` 0, `verify:unit:ts` 219/219 (incl. new
  receipt test), `verify:packed` green end-to-end; consumer lanes green
  under clamped peers (bun and npm).
- **Sessions**: 1 session, ~2.5 hours wall-clock, heavily parallelized
  across background subagents.

## 1. Wins

- **The lane caught real defects on first contact** — inc 02's very first
  run failed on next-plugin's ambiguous published types, and the follow-up
  attw sweep found masquerading types, a typeless `engine-v2` subpath, and
  node16 declaration-resolution failures across all five packages (journal
  20:27 surprise). This is the change's thesis proven empirically: the
  workspace graph structurally could not see any of it.
- **Adversarial review earned its cost** — 13 objection entries across 4
  passes; 9 accepted findings, every one leading to a concrete fix:
  registry platform-package leak (F1), fault-injection proof of engine
  fail-loud (F2), measured-not-asserted receipts (F3, then again at the
  final pass when `engineLoaded` still had a literal fallback), spec-text
  honesty (E2, PM-enforcement wording), webpack clamp + host-framework
  definition, CI receipt uploads.
- **Honest falsification of a decision mid-flight** — D7's uniform node16
  profile was disproven by inc 07 (pure-ESM packages structurally cannot
  pass node16-from-CJS) and revised to per-package profiles with a scoped,
  documented allowlist tied to DEF-5 rather than papered over.
- **The gate flip landed last and green** — `release.needs` went from one
  job to six with every lane already proven locally, so the flip itself
  carried zero risk (inc 03, G1 recorded).

## 2. Misses

- 🟡 **Packet 02's template had three consumer-blind spots** — theme-scale
  typing (`borderRadius: 4` only checked via test-ds), parent `@types`
  leakage into the "isolated" consumer, and Next's tsconfig lib-check
  clash. Each cost a red lane run to find (journal 21:25 friction).
  Follow-up: none needed — all fixed in-lane; the lane now encodes them.
- 🟡 **Two subagent claims survived until empirically re-checked** — inc
  07's "properties/system pass esm-only today" was false in the lane
  (21:22 surprise), and inc 06's "MEASURED, not hardcoded" comment sat on
  a literal `'v2'` (22:10 objection). Lesson: subagent assertions about
  gate outcomes get re-run by the orchestrator, never trusted from prose
  (this is exactly the trust-but-verify rule; it worked, but only at the
  review stage).
- 🟡 **Format-drift gap**: incs 02/05 landed files that failed
  `vp fmt --check`, discovered only by inc 06's defensive lint run. The
  increment packets did not include a fmt step; the lint composite is not
  in any per-increment gate. Follow-up in §6.
- 📌 **Footprint drift** (inc 06: showcase assert script location;
  registry corrected in place) and **one delegate misfire** (04 first
  dispatch) — both journaled, neither costly.
- 📌 **Verify WARN**: `bun.lock` changed as a side effect of declared
  devDeps; inc 02's inline-mode contract checkboxes left unticked per its
  collapse instruction (cosmetic).

## 3. Plan deviations

| Deviation | Journal trace |
| --- | --- |
| Row 07 spawned (publish-manifest-hygiene) — envelope had 6 rows | 20:28 spawn |
| D7 added mid-flight, then revised once on falsification | 20:28 spawn · 21:20 surprise · D7 text |
| DEF-5 added (declaration-emit toolchain gap) | 21:20 surprise · Ledger row |
| `--omit=optional` fix attempted and reverted (broke lightningcss) | 21:40 objection (F1 disposition) |
| Webpack clamp added beyond D3's original vite/next scope | 21:55 objection (heretic) |
| CI receipt uploads added beyond inc 06's original scope | 22:10 objection (heretic) |
| Landing order ran 01∥02 then 04/05 before 03 (design's migration list was 02-first) | 21:41, 21:56 reorientations — deps encoded the true constraints |

All deviations trace to journal entries; no untraced deviations found.

## 4. Skill / workflow compliance

- brainstorming: ✓ via the documented evidence-capture path (exploration
  pre-existed: external audit + repo verification + user's revised
  increment; cited at the top of brainstorm.md).
- writing-plans: ✓ (all seven packets authored against the skill's
  micro-step/no-placeholder discipline; packet 07 written mid-flight from
  the spawn).
- subagent-driven-development / dispatching-parallel-agents: ✓ in
  substance — delegate rows ran as cold-start subagents with output
  contracts, parallel dispatch only on disjoint footprints (01∥02, 04∥05,
  reviewer∥06).
- test-driven-development: partial — inc 06's receipt helper had a
  test-first unit test; the lane itself is verification-first by nature
  (its assertions ARE the tests). No conventional red-green cycles
  elsewhere; nothing in this change produced untested runtime code.
- executing-plans: ✓ (inline inc 02 followed its packet steps, recorded
  results per step).

### Deliberately Skipped Skills

None skipped where triggered. TDD's partial application above is a scope
judgment (CI/manifest/doc increments have no unit-testable surface), not a
skip of a triggered skill.

## 5. Surprises (journal triage)

- 20:27 (publint/attw harvest on first lane run) — **confirmed**; the
  founding surprise, drove inc 07 + D7.
- 21:20 ×2 (pure-ESM cannot pass node16 profile; extensionless-declaration
  root cause) — **confirmed**; institutionalized as revised D7 + DEF-5.
- 21:22 (esm-only claim didn't hold in lane) — **confirmed**; produced the
  scoped allowlist and the §2 trust-but-verify lesson.
- 21:50 (`[animus-extract] Transform failed for .animus/system-props.js`
  warning in Next builds) — **contextualized**: pre-existing, benign,
  out-of-change; spawned as a standalone follow-up task chip.
- 22:00 (hostVersion must come from fixture-local node_modules) —
  **confirmed**; encoded in all three assert scripts.
- No surprise remembered now is absent from the journal.

## 6. Promote candidates → long-term learning

- [ ] 🟡 **Add a format gate to increment closure**: any increment landing
      files should run `vp fmt <files>` (or `verify:lint`) before its
      registry tick — candidate for the ooda schema's guardrail-gate
      boilerplate or a repo CLAUDE.md workflow note.
- [ ] 🟡 **Durable guardrail promotion at archive**: G1 (release gate
      composition), G3 (no open-ended host peers), G5 (CLAUDE.md ownership
      rows) are durable invariants — promote to
      `specs/arch-release-gating/spec.md` (G1, G3) and the existing
      verification-tier-policy surface (G5) when archive runs. G2/G4 live
      inside the lane itself (already executable); no promotion needed.
- [ ] 📌 **Subagent gate claims are re-run, not read**: orchestrator
      re-executes any "passes X today" claim before depending on it —
      candidate for the delegate-brief boilerplate.
- [ ] 📌 **DEF-5 allowlist removal ride-along**: when the
      typescript-toolchain declaration-emit change lands, remove
      `--ignore-rules internal-resolution-error` from
      `scripts/verify/packed.sh` and re-tighten D7 — recorded on the
      Ledger row; noted here so the follow-up change inherits it.

**Archive decision (from verify report)**: **postpone** — implementation
is uncommitted working-tree state on `feat/random`; this schema performs
no VCS actions. Archive when the branch lands on the default branch as ONE
unit (the verify report's evidence-gap: untracked new files are not
captured by the diff fingerprint — a partial commit would strand the lane).
`unmerged-implementation` note: recorded here per apply step 5c.

> **Update 2026-07-15**: G1/G3/G5 are now reflected in the synced
> `release-workflow`, `peer-range-policy`, and `verification-tier-policy`
> capabilities; the packed contract is corrected to exercise each entrypoint's
> supported module modes. The full portfolio validates 140/140 and fresh
> `verify:ci` passes 29/29. Archive still waits for the complete tracked and
> untracked inventory to land on a clean `main` SHA.
