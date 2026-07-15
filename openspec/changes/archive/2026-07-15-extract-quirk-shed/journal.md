# Journal — extract-quirk-shed

- 2026-07-13 03:25 · seed — Apply started. Envelope-licensed rows: none
  (01-04/06 lazy on DEF-4, 05 on DEF-1, 07 on DEF-2). Specs fully
  authored at propose.
- 2026-07-13 03:25 · signal — DEF-4 resolving signal landed:
  `change:extract-v2-default-flip#02` ticked 2026-07-13 03:20 (plugin
  defaults are v2; G1 probe prints `v2`). Licenses creation of rows 01,
  02, 03, 04, 06. DEF-4 flips to resolved at row 01's tick per the
  registry.
- 2026-07-13 03:25 · signal — DEF-1 resolving signal executed: probe
  `rg -n 'selectorOrder' packages/showcase/src/ e2e/next-app/src/
  e2e/vite-app/src/ packages/test-ds/src/` matches only two showcase
  MDX doc pages (create-system.mdx, system-setup.mdx) — no authored
  config sets a non-default order. Direction per ledger: REMOVE from
  the SystemBuilder API. Licenses row 05.
- 2026-07-13 03:25 · mode-change — rows 01-04 will execute via
  delegated subagents against their packets (registry says
  mode:inline; orchestrator delegates for context economy under the
  4-change apply directive). Orchestrator re-runs all STOP-severity
  gates on each merged result and retains single-writer ownership of
  design.md/tasks.md/journal.md/specs.
- 2026-07-13 03:50 · surprise (via inc 01 agent) — dropping a
  component's only declaration empties its fragment, so
  componentFragmentKeys diverge: the shed shifts key SETS, not just
  sheet values. Register surface was 12 entries (css + observables +
  diagnostics × 4 units), not the anticipated css-validity 4.
- 2026-07-13 03:50 · surprise (via inc 01 agent) — v2 emits the alias
  warn in PROD for token-alias.tsx even though reconciliation
  eliminates the carrying component (Phase 5a precedes reconciliation);
  diagnostics artifact diverges in both modes, licensed accordingly.
- 2026-07-13 03:50 · friction (via inc 01 agent) — vite-plugin's
  diagnostics printer only prints kinds bail/skip; kind warn reaches
  the manifest but never the dev console. Outside inc-01 footprint.
- 2026-07-13 03:50 · spawn — DEF-5 + registry row 08 (plugin
  warn-diagnostic surfacing, vite + next) spawned from the friction
  above; extraction-diagnostics "surfaces in dev" scenario is the
  contract. Two further surfaced variables recorded WITHOUT rows (no
  witness in corpus, no consumer demand yet): shed coverage beyond the
  ComponentCss seam (utility/global/keyframes streams), and
  intentional-brace-literal escape syntax. Revisit if a witness
  appears.
- 2026-07-13 03:50 · reorientation (off-beat: entropy auditor) — inc 01
  merged after orchestrator re-ran STOP gates (G2 empty, G3 PASS, G4
  pass). DEF-4 resolved on its signal; no compare.ts drift;
  scoreboard.snap rewritten by the harness itself on the green run
  (its committed-baseline mechanism, not a hand edit). Row 01 ticked
  03:50; full pass due at row 02 (K=2).
- 2026-07-13 04:05 · surprise (via inc 02 agent) — v1's single empty
  Err arm has TWO v2 mirrors (facts-time fatal_error gate + post-facts
  process_chain_facts Err arm); both wired to the bail helper.
  Second witness diverged: extract/per-property-bail.tsx
  (SpreadComponent chain-fatal) — licensed alongside
  props-serde-reject.tsx.
- 2026-07-13 04:05 · friction (via inc 02 agent) — register licensing
  matches unit+artifact only: an already-licensed diagnostics entry
  absorbs ANY future diagnostics change on that unit unnoticed
  (extract-all demonstrated it, note appended manually). Content-level
  licensing is a harness-side candidate for the oracle-inversion
  increment (row 07), where compare code is legitimately in footprint.
- 2026-07-13 04:05 · reorientation (FULL adversarial pass, K=2) —
  Observe: rows 01+02 merged; parity PASS 0-unregistered both modes
  (21/25 divergences all licensed); consumer CSS byte-identical.
  Orient vs Ledger: DEF-4 resolved on signal; DEF-5 spawned properly;
  DEF-1 signal recorded, row 05 licensed; DEF-2/DEF-3 untouched.
  Falsifier: extraction-diagnostics "surfaces in dev" scenario would
  fail a black-box test today (warn kind not printed by plugins) —
  row 08 exists precisely for it; bail kind IS printed. Entropy
  auditor: unit+artifact licensing granularity is a real leak vector
  (friction above) — bounded by note-appending discipline until row
  07. Heretic: bail diagnostics on chains users never see (prod
  reconciliation) could be noise — rejected: bail is dev-visible
  where the developer needs it, and manifests are the contract.
  Decide: proceed rows 03→04. Act: row 02 ticked 04:05.
- 2026-07-13 15:41 · objection RF-1 (inc 03 spec review, accepted) —
  the initial hand scanner was not ECMAScript-semantic for BOM/Unicode
  trivia, directive trailing comments, or ASI continuations. Acted:
  OXC `Program.directives` became the sole classifier; end-to-end REDs
  now cover each counterexample and the `.length` non-directive control.
- 2026-07-13 15:41 · objection RF-2 (inc 03 code-quality review,
  accepted) — import stripping made the parsed directive offset stale,
  and trailing ASI comments could be split by injection. Acted: the
  unchanged legacy strip reports removal ranges; directive/comment
  structure is protected and valid removals remap the boundary with
  checked arithmetic.
- 2026-07-13 15:41 · objection RF-3 (inc 03 code-quality re-review,
  accepted) — a removed line could contain a block-comment delimiter or
  the directive itself, retaining an invalid fact. Acted: intersection
  with OXC directive or comment-delimiter spans clears the fact; exact
  delimiter variants and out-of-bounds metadata are regression-tested.
- 2026-07-13 15:41 · friction (inc 03) — the same-engine parity
  self-check prints `VIOLATED use-client-comment` for a family that
  expects registered divergence, although the self-check intentionally
  ignores family verdicts and the real v1/v2 gate passes. Bounded to row
  07's harness-reporting/oracle-inversion work; not a row-03 blocker.
- 2026-07-13 15:41 · objection RF-4 (reorientation reviewer,
  accepted) — ticked registry rows encoded signal/tick metadata where a
  packet path belongs, leaving packets orphaned; spec-taxonomy lint also
  found rationale wording and an implementation-shaped import contract.
  Acted: rows 01-06 now reference their packets with field-level evidence,
  taxonomy wording is behavioral, and both lints are re-run before tick.
- 2026-07-13 15:41 · signal — DEF-5 resolving evidence matured across
  two reorientations: increment 01's manifest-consumption audit shows
  Vite omits kind `warn`, while Next surfaces no manifest diagnostics in
  either production or HMR analysis. Direction: D5, surface warns in
  both always-on developer channels. Licenses packet 08.
- 2026-07-13 15:41 · mode-change — rows 03, 04, 05, 06, and 08 are now
  `mode:delegate · review:subagent`. Their semantic decisions are settled
  at this checkpoint and the remaining work is execution-dominant; row
  07 stays inline to resolve DEF-2/DEF-3 with the final divergence set.
- 2026-07-13 15:41 · reorientation (off-beat: entropy auditor) —
  Observe: inc 03 passed 297 Rust tests, a fresh v2 build, Next App/Pages
  consumer assertions, and full parity at 22/26 prod/dev divergences
  with 0 unregistered; independent spec and quality re-reviews report no
  remaining findings. Orient vs Ledger: DEF-1 reached its third review
  with the REMOVE signal already present, so it resolves to D4 and row
  05 now owns the two stale consumer contracts; DEF-5 reached its second
  review and resolves to D5/row 08; DEF-2/DEF-3 signals remain unavailable
  and their review boundary is revised to the row-06 reorientation.
  Entropy auditor: RF-1..RF-4 accepted and acted; same-engine reporting
  friction is explicitly carried to row 07. Decide: row 03 is safe to
  tick; continue row 04; remove serialized selector order in row 05;
  surface warn diagnostics in row 08. Act: promoted D4/D5, authored the
  row-05 MODIFIED deltas and row-08 packet, normalized registry paths and
  modes, reconciled packet/spec wording, and ticked row 03 at 15:41.
- 2026-07-13 16:16 · surprise (via inc 04 agent) — the first
  `transforms.` witness used a variant option, which made invalid selector
  syntax in both engines. Moving the literal to `defaultVariant`
  isolated import selection: the only new divergence is the dedicated
  transformed-code artifact.
- 2026-07-13 16:16 · objection RF-5 (inc 04 quality review, accepted) —
  named-transform import selection ignored the emitter's higher-priority
  inline transform source. A RED for both-present metadata failed;
  selection now requires no inline source, with named/inline/both and
  survivor-matrix tests green.
- 2026-07-13 16:16 · objection RF-6 (inc 04 quality review, accepted) —
  activating the aggregate `extract-all · code` register row without an
  observed aggregate divergence could mask a future code regression.
  It remains anticipated; only `parity/string-transforms-literal.tsx`
  owns the active license.
- 2026-07-13 16:16 · objection RF-7 (inc 04 quality review, accepted) —
  the focused proof omitted context-compose and the no-empty-import
  invariant. Test-only follow-up now proves the separate context import,
  consumed binding, directive order, clean base import, and unchanged
  compose-only/no-survivor early return; final quality re-review is clean.
- 2026-07-13 16:16 · friction (inc 04) — adding a second
  registered-divergence family repeats the same-engine self-check's
  `VIOLATED ... observed identical` wording. Real v1/v2 family verdicts
  are `ok`; content-level licensing and same-engine reporting remain
  carried to row 07.
- 2026-07-13 16:16 · objection RF-8 (FULL reorientation falsifier and
  entropy auditor, accepted) — final test edits made `engine.rs` newer
  than the v2 binary, so the fail-loud parity precondition rejected the
  stale receipt. Acted: reran `verify:unit:rust`, rebuilt v2, refreshed
  the tracked NAPI declaration, then reran full parity and all Vite,
  Next, and showcase consumer gates from the final source.
- 2026-07-13 16:16 · objection RF-9 (FULL reorientation heretic,
  accepted as bounded carry) — unit+artifact registration remains wider
  than content-level licensing, so even a precise active code row can
  absorb later changes on that artifact. No row-04 decomposition or NS2
  revision: row 07 already owns content-level licensing and family
  reporting mechanics.
- 2026-07-13 16:16 · reorientation (FULL adversarial pass, K=2) —
  Observe: inc 04's literal and metadata-precedence REDs are green; v2
  has 303 Rust tests, root `verify:unit:rust` passed 280 with 1 ignored,
  the final v2 release build succeeded, parity reports 23/27 prod/dev
  divergences with 0 unregistered, and fresh Vite, Next App+Pages, and
  showcase builds/assertions pass. Independent spec review and final
  quality re-review report no findings. Orient vs Ledger: D1 is tighter
  than predicted because the aggregate license stays anticipated and the
  dedicated witness owns the observed divergence; D2 order and D3's
  no-v1-backport constraint hold. NS1 is wrong→right without ride-along,
  NS2 is freshly evidenced, NS3 is unchanged. DEF-2/DEF-3 remain before
  their row-06/date review boundary; row 07 stays lazy. Falsifier and
  entropy objections RF-8 were accepted and cleared by final-source
  gates; heretic RF-9 is carried explicitly. Registry lint, all three
  spec-leakage lints, strict validation, G2, and G4 are clean. Decide:
  continue row 05; keep row 07 deferred and modes unchanged. Act:
  refreshed receipts, included generated `index.d.ts` in row 04's
  footprint, journaled RF-5..RF-9, and ticked row 04 at 16:16.
- 2026-07-13 17:05 · objection RF-10 (inc 05 quality review, accepted)
  — the integration spy pinned only arity and alias/null slots, so
  permutations in Vite or either Next analysis path could evade it.
  Internal typed tuple builders and distinct-sentinel tests now pin all
  14 positions for Vite prod/dev and Next prod/HMR.
- 2026-07-13 17:05 · objection RF-11 (inc 05 quality review, accepted)
  — parity `engine-run.ts` and the seam battery dynamically read the
  removed config field, escaping compile checks. Both now pass literal
  `null` in the retained ABI slot; full parity and both 14/14 seams pass.
- 2026-07-13 17:05 · objection RF-12 (inc 05 quality re-review,
  accepted) — canonical `verify:unit:ts` omitted Next's new tuple tests,
  and Vite's nominal production case passed `devMode: true`. The tier and
  root coverage table now include Next (and the previously undocumented
  parity suite); Vite separately pins false/true production/dev tuples.
- 2026-07-13 17:05 · objection RF-13 (inc 05 spec review + entropy
  auditor, accepted) — Vite declaration emit exposed the internal helper.
  A proposed root-only `exports` map hid it but changed package-subpath
  behavior, violating the no-plugin-API-change non-goal. The map/test
  were removed; `@internal` plus Vite-only `stripInternal` emits an empty
  helper declaration while preserving existing package resolution.
- 2026-07-13 17:05 · friction (inc 05) — `vp run build:system` is not a
  registered task; the documented package-filter build and aggregate
  build succeeded. The first final consumer attempt also failed loud on
  stale plugin dist and passed after both plugin packages were rebuilt.
- 2026-07-13 17:05 · friction (inc 05) — an extra non-authoritative
  direct `_integration` tsgo probe exposes existing fixture export and
  strictness errors. Changed D4 files were not diagnosed and the
  authoritative integration tier passes 138/138; a clean integration
  type-check tier remains a future verification-infrastructure candidate.
- 2026-07-13 17:05 · reorientation (off-beat: entropy auditor) —
  Observe: D4 REDs prove the removed serialized field and retained null
  slot; compile passes all nine workspaces, canonical TS units pass 11
  files/169 tests, integration passes 10/138, parity remains 23/27 with
  0 unregistered, and fresh Vite, Next App+Pages, and showcase assertions
  pass. Final independent spec/quality reviews report no findings. Orient
  vs Ledger: DEF-1's REMOVE prediction is fulfilled without touching v1;
  aliases remain active and the NAPI slot remains positional. NS1 removes
  a false advertisement without ride-along behavior, NS2 is freshly
  evidenced, NS3 is unchanged. DEF-2/DEF-3 remain before their row-06 or
  2026-10-01 boundary, so row 07 stays lazy. Entropy objection EA-05-1
  was accepted and cleared by rolling back the exports map; registry lint,
  strict validation, and all three spec-leakage lints are clean. Decide:
  continue row 06; keep row 07 deferred and all modes unchanged. Act:
  reconciled active parity consumers, made Next tuple tests canonical,
  hid helper declarations without a package-boundary change, journaled
  RF-10..RF-13, and ticked row 05 at 17:05.
- 2026-07-13 17:25 · signal (inc 06) — deliberately removing the
  `parity/duplicate-compose.tsx · code` license made the live-v1 gate
  fail in both modes with that unit as the sole unregistered divergence
  (23/1 production, 27/1 development). Restoring the exact active row-07
  handoff license returned parity to PASS. This is the packet's expected
  FAIL/restore branch: v2 is already correct, while physical deletion
  waits for oracle inversion. The tick fires DEF-2/DEF-3's resolving
  signal.
- 2026-07-13 17:25 · objection RF-14 (FULL reorientation entropy
  auditor, accepted) — unit+artifact licenses can absorb unrelated
  content drift. D6 requires baseline/candidate SHA-256 pairs on active
  licenses and bidirectional unit-set comparison.
- 2026-07-13 17:25 · objection RF-15 (FULL reorientation heretic,
  accepted) — allowing an ordinary v2 run to rewrite its own oracle is
  tautological. D6 separates immutable ordinary verification from a
  journal-intent refresh command; stale baselines stay red until the
  privileged refresh validates exact licenses, both modes, determinism,
  CSS, and families. Red runs never write oracle files.
- 2026-07-13 17:25 · objection RF-16 (DEF-3 loader audit, accepted) —
  copying the 1,300-line OXC/QuickJS loader into v2 would replace one
  retirement dependency with two implementations. D7 extracts it to a
  shared engine-neutral crate, exports it from v2, and routes the default
  plugins there while retaining v1 only as the explicit escape hatch.
- 2026-07-13 17:25 · reorientation (FULL adversarial pass, K=2) —
  Observe: inc 06's removal RED and restoration GREEN match the packet;
  fresh parity is 23/27 divergences with 0 unregistered, G2/G4 are clean,
  registry lint and strict validation pass, and independent implementation
  review reports no findings. Orient: D1/G3 correctly retain the license
  while live v1 remains; NS1 is already-right output with an evidence-led
  handoff, NS2 is freshly evidenced, NS3 is unchanged. The row-06 signal
  resolves DEF-2→D6 and DEF-3→D7. Falsifier objection that the license
  could drop now was disproved by the sole-unregistered RED; entropy and
  heretic objections RF-14..RF-16 were accepted into the final design.
  Decide: tick row 06; execute spawned row 08 before final row 07; change
  row 07 from lazy to a packet with dependency 08. Act: authored D6/D7,
  created increment 07, journaled the review, and ticked row 06 at 17:25.
- 2026-07-13 17:42 · test-red (inc 08) — focused plugin tests produced
  five expected failures: warn/bail/skip collectors were empty and Next
  had no production/HMR surfacing calls. The final focused suite passes
  5 files/19 tests and pins one parse-adjacent helper call in each Next
  method plus Vite's shared analysis path.
- 2026-07-13 17:42 · implementation (inc 08) — Vite and Next now surface
  manifest `warn` diagnostics on always-on developer channels as
  `[animus] ⚠ <file>: <component>: <message>`. Vite's established bail
  and skip wording moved into the shared analysis path without duplicate
  consumption; Next remains warn-only.
- 2026-07-13 17:42 · objection RF-17 (inc 08 independent review,
  accepted) — the first Next helper also emitted bail/skip, an unlicensed
  ride-along beyond D5. It was narrowed to warn-only; focused RED/GREEN,
  compile, lint, fresh Next build/assert, and parity all pass.
- 2026-07-13 17:42 · objection RF-18 (inc 08 independent review,
  accepted) — an aggregate count of two helper calls could pass if both
  moved into one Next path. The test now isolates `runFullPipeline()` and
  `runIncrementalPipeline()` and requires one helper immediately after
  each path's own manifest parse. Re-review reports no findings.
- 2026-07-13 17:42 · friction (inc 08) — the first showcase proof failed
  loud on stale Vite plugin dist; rebuilding the changed package via the
  prescribed task restored a green build/assert.
- 2026-07-13 17:42 · reorientation (off-beat: entropy auditor) —
  Observe: focused tests pass 5/19; compile passes all nine packages;
  integration passes 10/138; showcase, Vite, Next, lint, and parity are
  green with the live-v1 23/27 divergence counts unchanged and zero
  unregistered. Independent review's two P2 objections RF-17/RF-18 are
  closed and re-review is clean. Orient: D5/DEF-5 are fulfilled; NS1
  changes only silent→loud output, NS2 is unchanged/evidenced, and NS3's
  authored warn contract now reaches both plugin channels. Registry lint,
  strict validation, leakage lints, G2, and G4 are clean. Decide: tick row
  08; keep row 07 final with dependency 08 and its D6/D7 scope unchanged.
  Act: narrowed Next behavior, strengthened path proof, journaled evidence,
  and ticked row 08 at 17:42.
- 2026-07-13 18:45 · test-red (inc 07) — adversarial parity tests failed
  before each hardening step: registered ordinary drift could still look
  refresh-eligible, parser-count changes were invisible, missing units did
  not emit every artifact class, structural arrays could collide, orphan
  component flags escaped comparison, seam recording ignored baseline-only
  cases and wrote directly, malformed CLI options fell through, required
  corpus paths lacked remediation, non-required family metadata was not
  gate-critical, and stale-baseline output omitted the guarded refresh
  command. The final focused suite passes 5 files/42 tests.
- 2026-07-13 18:45 · implementation (inc 07) — standing parity now compares
  fresh v2 against immutable content-addressed production/development v2
  envelopes, with a v2-only 14-case seam oracle and empty live register.
  Ordinary drift is always red/read-only; refresh requires a checked intent,
  exact allowed-category hashes, both modes, deterministic processes/threads,
  CSS/parse/family invariants, and atomic pair publication. The system loader
  is one engine-neutral Rust crate consumed by both bindings; default plugin
  routes use v2 while the explicit v1 compatibility path remains available.
- 2026-07-13 18:45 · objection RF-19 (inc 07 quality review, accepted) —
  oracle comparison omitted parseCount and allowed structural collisions,
  orphan `hasComponents` paths, or incomplete missing-unit artifacts. Acted:
  the committed observable includes parser count, structural values compare
  as JSON, code/flag path unions are independent, and unit-set drift emits
  all four canonical artifact classes with focused regressions.
- 2026-07-13 18:45 · objection RF-20 (inc 07 quality review, accepted) —
  refresh and seam recording were not yet exact/atomic across mode pairs,
  families, categories, arguments, and unioned cases. Acted: pair-wide
  eligibility, runtime category validation, exact family drift, strict CLI
  parsing, baseline/seam union comparisons, and failure-preserving atomic
  publication are covered by RED/GREEN tests.
- 2026-07-13 18:45 · objection RF-21 (inc 07 quality review, accepted) —
  shared-loader tests computed the workspace root incorrectly and could skip
  package-resolution proof; freshness and CI also omitted crate metadata and
  the shared crate. Acted: fail-loud roots, explicit built-artifact skips,
  an ignored showcase test run for real, metadata-aware NAPI freshness, all
  three Rust unit/hygiene legs, pinned toolchains, and canonical CI wiring.
- 2026-07-13 18:45 · objection RF-22 (inc 07 spec/quality review, accepted)
  — ADDED-only deltas, CI, package descriptions, comments, and the root task
  map still described a live-v1 differential after oracle retirement. Acted:
  seven retired parity requirements plus the seam/tier policies are MODIFIED,
  refresh-only registration language replaces live licensing, parity is in
  full/CI composites, and standing docs/comments describe the committed v2
  oracle. Collision scan hits only this change.
- 2026-07-13 18:45 · objection RF-23 (inc 07 quality review, accepted) —
  validation covered only the five mandatory family names, allowing an
  additional malformed family to print `VIOLATED` without failing the gate.
  Acted: every declared verdict and unit reference validates before the
  separately asserted required-name set; the focused regression is green.
- 2026-07-13 18:45 · objection RF-24 (inc 07 spec review, accepted) — final
  packet counts/hashes, authorship pointers, toolchain/composite descriptions,
  and register comments lagged the implementation. Acted: the packet records
  5/42 focused and 17/202 canonical TS tests, exact current oracle hashes,
  every authored requirement, and the final G2/G3/G4 evidence. Both
  independent re-reviews report no remaining actionable findings.
- 2026-07-13 18:45 · objection RF-25 (inc 07 spec review, accepted) — an
  ordinary stale-baseline failure named the condition but not the safe path
  forward. Acted: the CLI now says an intentional change needs exact register
  entries plus a checked intent and names
  `scripts/verify/refresh-parity-baseline.sh <checked-intent-id>`; the message
  has a focused regression.
- 2026-07-13 18:45 · friction (inc 07) — the parallel local `verify:ci`
  composite can race `build:ts` cleanup against atomic tiers that intentionally
  fail loud instead of rebuilding upstream. Prebuilding TypeScript artifacts
  and running the canonical graph with `--concurrency-limit 1` passed all 17
  tasks. A whole-tree Rust format probe also exposed broad pre-existing
  v1/v2 rustfmt-version drift; the changed shared-loader crate itself passes
  `cargo fmt --check`, so no unrelated mass reformat rode this change.
- 2026-07-13 18:45 · objection RF-26 (FULL reorientation heretic, rejected)
  — physical v1 deletion would make “retirement” cleaner than retaining a
  compatibility binding. Rejected for this release: D7 explicitly requires a
  reversible v1 escape hatch, and Vite, showcase, and Next all build/assert
  with `ANIMUS_ENGINE=v1`; standing verification/default loading no longer
  depends on it, so deleting it now would break the promised boundary.
- 2026-07-13 18:45 · guardrail-trip reconciliation — row 04's final-source
  G3 attempt halted on the stale-v2-binary precondition recorded in RF-8.
  The row remained unticked until `verify:unit:rust`, the v2 release rebuild,
  standing parity, and all three consumer gates passed from the newer source.
  Increment 06's sole-unregistered run was a planned RED/restore branch, not
  a final guardrail disposition; its restored final gate passed.
- 2026-07-13 18:45 · reorientation (FULL adversarial pass, K=2) — Observe:
  inc 07 passes 5/42 focused and 17/202 canonical TS tests; Rust passes v1
  272, shared 8 (+1 ignored and explicitly exercised), and v2 303; hygiene is
  clean for all three crates; canary is 199, integration 10/138, compile all
  nine workspaces, lint/format clean, serial CI 17/17, default-v2 and explicit
  v1 consumers green. Three final parity runs after hardening each report
  48/48 production and development, seam 14/14, zero drift/unregistered, and
  all families identical; production/development/seam hashes remain
  `01b1a909...b5475`, `3c27aeff...6de2`, `a9e6fee2...db9ab`. Registry lint,
  three leakage lints, shell syntax, diff check, targeted strict validation,
  and collision scan are clean; portfolio validation's four failures are
  unrelated pre-existing artifacts. Orient: DEF-2→D6 and DEF-3→D7 match the
  landed boundary; NS1 remains only silent→loud/wrong→right sheds, NS2 is
  stronger with immutable exact baselines and an empty register, and NS3's
  diagnostics are authored and consumer-visible. No lazy row or Review-by
  remains open. Falsifier objections RF-19/RF-20/RF-23/RF-25 were accepted
  and cleared by black-box regressions; entropy objections RF-21/RF-22/RF-24
  were accepted and reconciled with clean schema/lint evidence; heretic RF-26
  is rejected by the consumer-proven compatibility promise. Decide: row 07 is
  safe to tick; all eight rows are complete; proceed to independent verify and
  retrospective. Archive is postponed because verification is on the user's
  intentionally dirty, uncommitted tree. Act: reconciled the packet/specs,
  retained D6/D7 and G4's replacement form, ticked row 07 at 18:45, and spawned
  no follow-up row.
