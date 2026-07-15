# Journal: extract-v2-spine

### 2026-07-12 16:05 · envelope · seed

Envelope complete (brainstorm → peer review → proposal → design → specs →
registry). Envelope-licensed registry rows: 01 (v1 determinism proof +
baselines), 02 (parity harness + adversarial corpus), 03 (dual-build
mechanics), 04 (v2 skeleton: owned-AST store + chain_walker bug-compatible
port). Lazy rows licensed with their blockers: 05 (DEF-2), 06 (DEF-1),
07 (DEF-11), 08 (DEF-7). Remaining spine-module ports will be spawned at
reorientation checkpoints as rows 04+ land → registry is the only
completion truth.

### 2026-07-12 16:06 · envelope · objection

Pre-design three-stance peer review (architecture-skeptic, delivery-risk,
domain-correctness; APPROVE-WITH-OBJECTIONS ×2, REQUEST-CHANGES ×1).
Blocking findings and dispositions, all folded into brainstorm amendments
and design.md before any spec text was authored:
(1) "differential oracle already exists" was false — only the corpus is
reusable; canary tests are substring assertions → harness authored as a
real capability (specs/extraction-parity-harness), increment 01 proves the
substrate. (2) v1 is not byte-deterministic against itself (std HashMap
serialization in emitted JS + manifest; wall-clock timing field) →
per-artifact-class parity bar (design.md D2), sanctioned v1 determinism
patch (D10), self-check gate (G8). (3) Symbol-correct resolution breaks the
MDX provider-scope contract (mdx-rendering.test.ts) and confounds bring-up
parity → bug-compatible-first sequencing (D3), G9 fixture precondition,
rendered-usage-semantics spec. Full review texts summarized in
brainstorm.md §Peer review record (immutable) → verify §14 should
aggregate these as RF-1..RF-3.

### 2026-07-12 16:07 · envelope · friction

G3's originally sketched regex was demonstrated vacuous by a reviewer
against the exact defect class it bans (character class could not cross a
method call). Corrected and calibrated: positive control fires 10× on v1
including all four motivating sites → every guardrail regex in this change
ships with a positive control and the register records calibration
evidence (design.md Guardrail Register).

### 2026-07-12 20:38 · inc 01 · objection

Reviewer subagent (three stances) returned PROCEED-WITH-OBJECTIONS after
live-verifying tests + double-run + pre-patch evidence. Dispositions:
(RF-4) FALSIFIER: manifest→virtual-module nondeterminism — system_prop_map
(project_analyzer.rs UniverseManifest) and dynamic_props (incl. nested
scale_values) serialize unsorted into the manifest and flow verbatim
through vite-plugin JSON.stringify into `virtual:animus/system-props`,
i.e. consumer bundle bytes outside D2's pinned surface. ACCEPTED → spawn
row 09 (same sanctioned defect class, ~attribute-level v1 sort) +
increment 02 must either add the virtual-module composition point to the
comparison surface or record its exclusion as an explicit register entry.
(RF-5) FALSIFIER: unit test left scaleValues and outer customPropMap sorts
unpinned — ACCEPTED, fixed at this reorientation (assertions added for all
four sites; 23 emitter tests green).
(RF-6) FALSIFIER: two-run methodology has ~50% miss probability per 2-key
map — RECORDED; mitigated by 3-key corpus maps and by the harness
self-check becoming the continuous automated check.
(RF-7) ENTROPY: packet footprint omitted the change-directory artifacts its
own Objective required — ACCEPTED, footprint amended on the packet;
convention forward: packets may write openspec/changes/extract-v2-spine/\*\*.
(RF-8) ENTROPY: D1 evidence over-claimed (fixture scale ≠ real scale) —
ACCEPTED, packet header + baselines.md reworded; showcase-scale numbers and
empirical parse counts explicitly owed by increment 02.
(RF-9) ENTROPY: output contract unticked at review time — ACCEPTED, filled
at this reorientation (inline-mode collapse).
(RF-10) HERETIC: D2 measurement-point altitude — the defect class this
increment fixed can still reach consumers via manifest-derived bytes the
raw-NAPI surface cannot see. ACCEPTED as an increment-02 Act item (surface
definition decision), not a design.md revision yet.

### 2026-07-12 20:40 · inc 01 · reorientation

Observe: increment 01 landed — sanctioned determinism patch (4 sort sites,
transform_emitter.rs), red→green double-run proof both NAPI paths + both
dev modes, gates green (280 rust / 197 canary / integration exit 0), G3
control unchanged at 10. Reviewer objections and dispositions recorded
above; one [~] (integration-fixtures double-run → harness self-check).
Orient: vs Ledger — D10 executed as predicted; no DEF resolved without
signal (baselines supply DEF-5's signal without deciding it). Vs North
Star — NS6 now holds on the D2 surface for v1, with a known altitude gap
(RF-4/RF-10) assigned to increment 02; NS5 intact (only sanctioned key
order changed in outputs); NS1-NS4 not yet exercised (no v2 code). Lazy
rows vs Review-by: all fresh, none breached. Stance summary (full pass,
first post-envelope increment): falsifier found a real adjacent leak;
entropy auditor found instrument drift (footprint, over-claim) now fixed;
heretic verdict recorded verbatim — "perf leg weakened at fixture scale;
showcase-scale + empirical parse counts are now the load-bearing D1
evidence, owed by increment 02" — plan holds because D1 pre-registered the
counterfactual, NS5 keeps abandonment cheap, and increment 02 is itself the
falsification instrument.
Decide: continue; spawn row 09 (manifest-consumer determinism sort,
executes immediately); increment 02 inherits two Act items (comparison-
surface altitude decision; showcase-scale + parse-count measurements).
Act: fixes applied inline (tests, packet grammar, wording); row 09 spawned;
row 01 ticked citing this entry.

### 2026-07-12 20:41 · inc 09 · spawn

Row 09 added mid-flight: v1 manifest-consumer determinism — sort
system_prop_map, dynamic_props, and nested scale_values at manifest
serialization (project_analyzer.rs), extending the sanctioned D10 defect
class to the manifest-derived consumer bytes found by RF-4. Tiny
mechanical scope → mode:inline, review:self (off-beat entropy-only
reorientation on land).

### 2026-07-12 20:52 · inc 09 · surprise

While verifying the manifest sort, the extended double-run surface showed
inner map keys ['8','16'] — apparently unsorted — despite the BTreeMap
helper. Cause: JavaScript canonicalizes INTEGER-LIKE object keys
numerically at JSON.parse, regardless of source byte order; the vite-plugin
virtual-module composition (parse → stringify) therefore re-orders
integer-like keys deterministically on its own, while non-integer keys pass
through in manifest order. Implication for increment 02: the comparison
surface at the virtual-module composition point is JS-canonicalized —
harness comparisons there must run post-parse (as the extended runner now
does), and raw-manifest-byte comparison of integer-keyed maps would be a
false signal. → capsule note for row 02.

### 2026-07-12 20:53 · inc 09 · reorientation

Observe: row 09 landed — sorted serialization helpers on system_prop_map /
dynamic_props / scale_values; extended-surface double-run deterministic
both dev modes at the consumer composition point (non-vacuous: 9 populated
system props); gates green (280 rust / 197 canary / integration 0); G3
control 10. Orient (off-beat, entropy auditor only — review:self row): no
deferral resolved without signal; no spec writes; footprint honored
(project_analyzer.rs + tools). One instrument note: journal wall-clock
stamps for the 01 entries ran ~10 min ahead of true clock — position in
file remains the authoritative order per schema; no correction needed.
Decide: continue to increment 02 (deps satisfied: 01 ticked). RF-4's
residual half (comparison-surface altitude) remains an increment-02 Act
item, now sharpened by the canonicalization surprise. Act: row 09 ticked
citing this entry.

### 2026-07-12 21:05 · inc 02 · signal

DEF-9's resolving signal (register built + first populated entries)
appeared during increment 02 itself — the harness's first full run
produced real entries to adjudicate. Row flipped → D13 in design.md.

### 2026-07-12 21:10 · inc 02 · surprise

The CSS-validity check found latent v1 behavior on its FIRST run:
unresolvable token aliases pass through raw into emitted CSS with no
diagnostic — `{colors.current-bg}` (contextual-vars fixture under uniform
corpus config; canary supplies per-fixture contextualVars so its tests
never see it) and the deliberate negative-test aliases
(`{colors.nonexistent}`, `{colors.does-not-exist.999}`) which reveal the
passthrough CONTRACT: v1 emits invalid CSS by design on unresolved
aliases, dev-mode retaining components that prod reconciliation would
eliminate. Adjudicated as four active known-quirk register entries;
candidate intentional-correctness follow-up post-flip (surface a
diagnostic instead of silent invalid CSS).

### 2026-07-12 21:11 · inc 02 · friction

Two packet-capsule gaps found while wiring: (a) `preprocessMdx` returns
`{kind, source}` (async), not a string — capsule said "compiled via
preprocessMdx" without the shape; (b) oxc-parser ESTree output carries
quote style in `raw` fields — AST-equivalence must strip `raw` alongside
spans or quote style reads as divergence. Both fixed in-harness; noted so
later packets embed exact shapes.

### 2026-07-12 21:12 · inc 10 · spawn

Row 10 added: v1 parse-counter — additive `parse_count` field in
`PipelineTiming` (timing is outside the parity byte surface by D2),
incremented per Parser::new invocation across v1 parse sites, so the
harness `--parse-count` mode gains empirical v1 counts (D1 evidence;
currently informational-only per scoreboard note). Mechanical,
mode:inline, review:self.

### 2026-07-12 21:45 · inc 02 · objection

Reviewer (three stances, live-verified: snaps byte-reproduced, 15/15 tests,
lints clean) returned PROCEED-WITH-OBJECTIONS. Dispositions:
(RF-11) intra-layer reorder classified as value not rule-order — ACCEPTED,
classifier now recurses into @layer/@media/@supports with header-prefixed
flattening + statement-at-rule splitting; test added.
(RF-12) surface omitted manifest.sheets + component_fragments VALUES (both
consumer-visible) — ACCEPTED, added to UnitSurface/spec/D2. Expansion
immediately exposed REAL v1 nondeterminism (see surprise below).
(RF-13) AST equivalence sorted every ObjectExpression, masking spread-order
and duplicate-key semantics — ACCEPTED, sorting now licensed only for plain
unique-key record literals; two negative tests added.
(RF-14) red runs overwrote baseline snaps — ACCEPTED, failing runs write
last-failure.txt and never touch committed snaps (spec's baseline gating
now mechanical).
(RF-15) --threads was doc-only — ACCEPTED, implemented via RAYON_NUM_THREADS
per self-check leg; exercised 1-vs-8.
(RF-16) register prefix matching lacked delimiter discipline — ACCEPTED,
prefix only for entries ending '/', else exact; entries trued.
(RF-17) diagnostics compared via join(' ') byte-collision risk — ACCEPTED,
JSON.stringify. Also: footprint staleness (amended on packet+registry at
tick), packet arithmetic (9 parity + 9 integration, fixed), self-check.snap
now evidences both modes.

### 2026-07-12 21:46 · inc 02 · surprise

RF-12's surface expansion instantly caught new REAL v1 nondeterminism:
`component_fragments` serialized in random HashMap key order — visible in
fresh-process diffs (27/35) and thread-variation runs (21/35 at 1-vs-8
threads). All value-content was identical; the instability was key order
only. Fixed as a one-field extension of the row-09 sanctioned determinism
class (`serialize_with = "sorted_map"` on component_fragments,
project_analyzer.rs — outside row 02's declared footprint, deviation
recorded here under the D10 sanction). Post-fix: self-check 35/35 both dev
modes AND 1-vs-8 threads. NS6 (determinism across runs AND thread counts)
now holds empirically for v1 on the full expanded surface.

### 2026-07-12 21:48 · inc 02 · reorientation

Observe: harness live (35 units, 4 surfaces + validity, register,
self-check incl. thread leg, parse-count reporting), identity green both
modes, 18/18 synthetic tests, snaps committed from green runs only;
showcase-scale D1 numbers recorded; two review cycles (inline objections
above) each caught real defects — the harness found latent v1 issues in
both of its first two full runs (alias passthrough; fragments key order).
Orient (FULL pass — surprise since last full): falsifier — classifier and
surface holes fixed and tested; entropy — DEF-9 resolved WITH signal (D13);
footprints trued; lints clean and non-vacuous; heretic — recorded verbatim:
the plan holds on the correctness/maintainability leg only; the exit
criterion is now explicit — "if v2's boundary/IR redesign gets trimmed to
'v1 but tidier', the incremental path dominates and that is the moment to
exercise NS5's cheap exit rather than push the flip."
Decide: continue to increment 03 (dual-build mechanics); rows 10 (parse
counter) and the sheets-thread-content question closed empirically (thread
leg green post-fix). Act: spec/D2 surface expansion authored; register
discipline tightened; row 02 ticked citing this entry.

### 2026-07-12 22:20 · inc 03 · objection
Reviewer (three stances; live-verified crate tests, loader probe, parity
gate, all five arch checks + controls, leakage lints) returned
PROCEED-WITH-OBJECTIONS. Dispositions:
(RF-18, BLOCKING) with-animus.ts constructed the webpack plugin from an
explicit field subset that dropped `engine` — withAnimus({engine:'v2'})
silently stayed v1. FIXED; dist-verified (`engine: options.engine` at
dist/index.mjs:646; constructor write at :31). Exposed gap: next-plugin has
no test suite — recorded as scope input for DEF-1/row 06.
(RF-19, BLOCKING) design.md self-contradiction: the earlier DEF-10/G3/G4/G7
edits were silent no-ops (formatter had re-wrapped the tables; replaces ran
without asserts). Root cause noted for process: exact-string edits on
formatter-touched files MUST assert. Trued by line-index edits; verified by
grep; G4 row now records the carry-over allowlist: EMPTY.
(RF-20) dtolnay/rust-toolchain exports RUSTUP_TOOLCHAIN which overrides
directory toolchain files — the v2 CI step now unsets it so the crate pin
governs. (RF-21+RF-23) verify:parity preconditions moved to
scripts/verify/parity.sh: compgen-based existence (multi-match-safe) +
mtime freshness for BOTH engine binaries. (RF-22) dual-engine-build
§Engine selection "the v2 engine performs extraction" is recorded as
ARMS-AT-FLIP: v2 routing is live and fail-loud, extraction conformance
arrives with the v2 surface increments — the scenario is intentionally
unmet until then. (RF-24) blanket openspec/** lint exclusion narrowed to
openspec/changes/**; schema scripts stay linted under CLI-rule overrides.
(RF-25) published-surface promise (./engine-v2 export with no release
artifact) → DEF-13 Ledger row; loader error message made npm-consumer-aware.
(RF-26) verify:unit:ts now includes packages/_parity/__tests__ (tier runs
165 tests incl. the 18 parity synthetics). (RF-27) CORRECTION to the 21:48
entry: registry row 10 (v1 parse counter) remains OPEN — only the
thread-content question was closed; the phrase "rows 10 … closed" was
wrong. (RF-28) residual recorded: the engine singleton is process-global —
two differently-configured withAnimus wrappers in one process last-write-
win; assigned to DEF-1 (handle ownership topology).

### 2026-07-12 22:22 · inc 03 · reorientation
Observe: dual-build landed — v2 crate compiles oxc 0.139 under its own
toolchain pin (first-contact churn: ParserReturn.errors→diagnostics);
standard build produces both engines; engine option plumbed through both
plugins via single choke-points (vite factory, next singleton — the
BLOCKING passthrough bug fixed and dist-verified); verify:parity tier live
with freshness preconditions; CLAUDE.md ownership rows in same change; CI
caches + tests the v2 crate on its pinned toolchain; all five arch
requirements authored with live calibration; registry lint 0/0.
Default-invariance evidence: integration 136/136, vite + showcase consumer
tiers green; verify:next fails PRE-EXISTING (typescript package removed in
tsgo migration; Next requires it to load next.config.ts — spawned as a
separate repo task, outside this change).
Orient (off-beat + reviewer stances): falsifier caught a real
consumer-facing bug (RF-18) that no in-repo test could catch — next-plugin
test coverage is a genuine hole feeding row 06 scope. Entropy caught
instrument drift (RF-19) with a durable process lesson. Heretic conceded
the ordering (arming G3/G4/G7 before spine code is the point; the layout
decision produced load-bearing information) with one standing concession →
DEF-13. Ledger: DEF-10 resolved → D14 with its signal; no other row
touched without signal. North Star: NS5 evidenced live; NS7 exercised
(rolldown-style crate boundary).
Decide: continue to increment 04 (v2 skeleton: owned-AST store +
bug-compatible chain walk — deps satisfied). Act: fixes applied inline
(all recorded above); row 03 ticked citing this entry.

### 2026-07-12 23:05 · inc 04 · objection
Reviewer (three stances; live-verified 23/23 crate tests, oracle run,
all G-gates + controls, verbatim-port diff of the test module) returned
PROCEED-WITH-OBJECTIONS; found ZERO semantic drift in the walk itself and
judged the unsafe Send justification sound for current use (with a
recorded warning: parallel reads over &AstStore would demand Sync, which
the arena's interior Cells do not license if any pass mutates).
Dispositions:
(RF-29) oracle compared only set membership + edge names — ACCEPTED,
chain-parity.ts now compares descriptor CONTENT (terminal, tag) for every
witnessed component, and prints an audit line for every v2-only
descriptor; all five extras are explainable (manifest witnesses survivors
only: cross-file extension parent, eval-time spread bail, cycle drops).
Span-value equivalence remains untested cross-engine — recorded gap; the
0.124→0.139 span-drift channel surfaces at the stage-eval increment where
spans are first consumed; ported tests cover synthetic bail paths.
(RF-30) extension-edge check was vacuous-when-missing — ACCEPTED, missing
v2 edge is now a failure (re-run green).
(RF-31) parseCount was a racy process-global and the store-local count was
tautological — ACCEPTED, counter is now threaded per-build (ParseCounter
into every parse; store count = counter, not len), global removed,
discover_chains returns the per-call count; probe refactored through the
ownership module so Parser::new is contained in exactly one file (RF-32,
structural leg added to G1's fenced block).
(RF-33) unused oxc features semantic/ast_visit — ACCEPTED, trimmed (D6
explicit-need); rebuild + tests green.
(RF-34) packet placeholders/instrument mismatch — packet was filled
mid-review; G1's registered command now names the interim instrument
(armed-via-tool) with the harness command taking over at inc 06. Spawn
candidates recorded below.

### 2026-07-12 23:07 · inc 04 · reorientation
Observe: first v2 spine code landed — ownership module (self_cell, one
file), parallel store with construction-counted parse budget, chain walk
bug-compatible on two independent oracles (v1's 20-test module verbatim:
all pass; corpus oracle: 35 units, 110/110 witnessed components matching
on membership+terminal+tag, strict extension edges, parseCount==fileCount
everywhere). Gates: G1 (interim instrument) green; G3 0/control 10; G4 0;
G6 PARITY GATE PASS; G7 umbrella-only; containment self_cell=1,
AstBuilder=0, Parser::new=1 file. verify:parity tier unaffected.
Orient (FULL pass per packet — first v2 code): falsifier found instrument
gaps, no walk drift; entropy found packet-state lag (filled) and dead
features (trimmed); heretic's D4 verdict recorded VERBATIM as the ledger
state: D4 is implemented-with-falsification-PENDING, not confirmed —
"if the stage-argument-evaluation/JSX increment completes without reading
any stored program() after cross-file resolution, D4's falsification
fires — shrink to per-file scope and delete the self_cell/Send machinery."
Spawn candidates surfaced: (a) harness chain-descriptor artifact class +
v2 engine wiring (belongs with the increment that gives v2 an
analyzeProject-shaped surface, row 06); (b) stage-argument evaluation +
JSX scan over the store — THE D4-discriminating increment, next spine
port; (c) span-value cross-engine assertions ride with (b), where spans
are first consumed.
Decide: continue; next rows — 10 (v1 parse counter, mechanical, ready)
then spawn (b) at its own row. Act: fixes applied inline; row 04 ticked
citing this entry with D4 marked falsification-pending.

### 2026-07-12 23:20 · inc 10 · reorientation
Observe: row 10 landed — v1 reports timing.parseCount; harness
--parse-count consumes it; empirical economy measured: 7.0×/7.4×/8.0×
parses per file (1/16/62-file corpora) vs v2's 1× by construction. Gates
green (280 rust / 197 canary / integration 0 / G3 control 10 / self-check
PASS). Orient (off-beat, entropy only — review:self row): one process
lapse caught and corrected mid-increment — an UNASSERTED exact-string
replace silently no-opped on formatter-reflowed code (the exact RF-19
class the journal already warned about); the fix landed with asserts and
the lesson is now twice-recorded: never replace without assert on
formatter-touched files. Field naming corrected (PipelineTiming is
serde-camelCase). [~] on the Rust unit test with the harness mode as the
automated equivalent — honest and recorded. Footprint held.
Decide: continue — all remaining rows are lazy on DEF signals; the
inc-04 reorientation's spawn candidate (b) is now due: spawn row 11,
stage-argument evaluation + JSX scan over the owned-AST store — the
D4-discriminating increment (its outcome fires or clears D4's
falsification). Act: row 10 ticked citing this entry; row 11 spawned
(journal entry follows).

### 2026-07-12 23:21 · inc 11 · spawn
Row 11 added: v2 stage-argument evaluation + JSX usage scan over the
owned-AST store, bug-compatible with v1's per-property skip model —
the increment whose implementation answers D4's falsification criterion
verbatim ("if it completes without reading any stored program() after
cross-file resolution, D4's falsification fires"). mode:inline,
review:subagent. Spawn licensed by the inc-04 reorientation Decide.

### 2026-07-12 23:24 · envelope · signal
DEF-4's resolving signal appeared: parse-once landed (inc 04) and the
benchmark data exists (inc 10: 1×/7-8× parse ratios; alloc behavior
per-task Allocator::default() measured adequate at corpus scale — analyze
wall time single-digit ms). This licenses creating row 11's packet (lazy
→ live), whose implementation decides DEF-4 (pool vs per-task) against a
real workload and answers D4's falsification criterion.

### 2026-07-13 00:05 · inc 11 · friction
Ports landed green in three moves (evaluator 61 tests, then facts layer,
then jsx_scan — 119 total), but the jsx port sharpened D4 to its decisive
form, which the packet's eager-first framing under-specified: v1's
scan_jsx(program, component_props, member_expr_bindings) consumes
CROSS-FILE-derived prop maps (global_component_props union, v1 Phase 5b)
while walking the per-file AST — the single place a stored AST might be
read after cross-file resolution. Two designs: (a) v1-shaped — keep the
store alive until global maps exist, scan with them (D4 CONFIRMED: the
store earns its keep); (b) facts-shaped — eager per-file RAW usage facts
(every candidate tag: name/member path, attrs with Static(value)/Dynamic
classification, createElement callees), then cross-file filtering as pure
fact algebra (D4 falsification FIRES; store shrinks per its recorded
criterion). Outcome-equivalence between (b) and the verbatim-ported
scan_jsx is directly property-testable inside v2. Decision to be made at
implementation, evidence recorded here either way.

### 2026-07-13 00:35 · inc 11 · surprise
D4 VERDICT — the falsification criterion from the inc-04 reorientation
FIRES, with proof: design (b) implemented (usage_facts.rs) — raw per-file
JSX usage facts (component-agnostic AttrFact classification, dotted-key
member tags, createElement facts, single visit-order stream) + cross-file
filtering as pure fact algebra. Four property tests adjudicate
outcome-equivalence against the VERBATIM-PORTED scanners on shared inputs
(static/dynamic/skip attrs; variants/states/absence-defaults; member
expressions + createElement incl. React.createElement and string-literal
non-attribution; spread + namespaced attrs) — all agree, field by field,
order-faithful (123/123 crate tests). Combined with inc-11's earlier
evidence (chain discovery, stage evaluation, statics, captured-transform
source all per-file), NO consumer reads a stored program() after
cross-file facts resolve. Per the recorded criterion: "shrink to per-file
scope and delete the self_cell/Send machinery" — the store-shrink row is
spawned at the coming reorientation; the heretic's alternative
(brainstorm's partial-value IR) is vindicated as the v2 architecture.
NS7 note: this is the second time a reference pattern (rolldown's
build-long AST store) was pressure-tested against animus's topology and
lost to a simpler local design — the North Star's revisit clause working
as intended.

### 2026-07-13 00:55 · inc 11 · surprise
The rendered-components oracle caught TWO v1 semantics the facts model
did not yet carry (7 corpus failures, all one class): (1) v1's ledger
records LOCAL ALIAS names — Phase-5b augments per-file maps from import
specifiers (`import { Button as TestButton }` → tag TestButton matches,
ledger stores "TestButton"); requires per-file IMPORT FACTS
(local/imported/source per specifier) + name-based alias resolution as
fact algebra (bug-compatible with v1's follow-by-name). (2) asClass
resolvers count as rendered via CALL EXPRESSIONS (`button({...})`,
lowercase bindings in extract-all), a third usage-fact kind beyond
JSX/createElement. Both are per-file AST facts — design (b) UNCHANGED and
the D4 verdict stands; the facts model needs import facts + resolver-call
facts, then the oracle rerun. v2-rendered extras (NavLink on the
single-file extension-child unit) are the known post-eval-membership
asymmetry — audit-only. Gate status: chain/descriptor/parse checks remain
green; rendered cross-check red pending the two fact kinds. This is the
oracle doing exactly what it was built to do — surfacing semantic gaps
BEFORE they could confound downstream parity.

### 2026-07-13 01:20 · inc 11 · objection
NOTE on clock drift: journal stamps have drifted ~2 h ahead of wall clock
(review E3); position-in-file remains the authoritative order per schema.
CORRECTION to the 00:55 entry (review E4): the "class-resolver CALL
facts" hypothesis was WRONG — v1 marks asClass chains and ALL compose
slot bindings rendered UNCONDITIONALLY (project_analyzer ~1514-1530,
verbatim comment); no call scanning exists in v1. The CallIdent fact was
removed before landing; import facts (alias augmentation) were the real
missing kind and are shipped.
Reviewer (three stances; live-verified 123 tests + oracle + containment;
diffed ported modules against v1 — zero silent expectation edits)
returned PROCEED-WITH-OBJECTIONS. Dispositions:
(RF-35, BLOCKING) stage dispatch was uniform where v1 dispatches
per-method — FIXED and test-pinned (127 tests): variant → parse_variant_arg,
no statics, no capture; identifier args resolve from same-file statics
with v1's exact error strings; compound second arg statics-BLIND,
captures discarded, skips kept; ANY stage error is CHAIN-FATAL with v1's
"{method} eval failed:" prefix and short-circuits remaining stages.
Four new tests mirror the reviewer's failure scenarios; oracle re-green.
(RF-36) oracle scope shrank vs the packet's plan (evaluated-config +
usage-ledger comparison beyond rendered) — RECORDED AS DEBT owed to the
cross-file-phase row, which also owns moving the TS-mirrored fact algebra
(alias augmentation, unconditional rendering) into the engine (RF-37).
The rendered gate's one-directionality is likewise noted there.
(RF-38) DEF-4 flipped with honest adequacy wording (not an A/B);
ast_store comment trued. (RF-39) lib.rs doc over-claim trued ("no read
after cross-file resolution", not "no AST outlives the pass").
(RF-40) index-v2.js clarification: NO edit was needed for extractFacts —
the loader's Proxy passes through new native exports; footprint holds.

### 2026-07-13 01:25 · inc 11 · reorientation
Observe: row 11 landed — evaluator + JSX scanner ported with v1 test
modules verbatim (92 ported tests), eager per-file fact extraction with
v1-faithful per-method dispatch (127 crate tests), fact-algebra usage
filtering property-tested against the ported scanners, import-alias
facts, extract_facts NAPI; oracle green across 35 units incl.
rendered-components with v1-mirrored alias augmentation + unconditional
asClass/slot semantics; parse budget files×1 on both surfaces; all
structural gates green; PARITY GATE PASS.
Orient (FULL pass — D4 verdict): falsifier caught a real BLOCKING
dispatch divergence BEFORE it could confound row-05 CSS parity (D3's
design intent, twice-proven); entropy caught undischarged DEF-4 and doc
over-claims (all trued); heretic ADJUDICATED D4 — the criterion fired on
clean evidence, and the shrink's true shape is precise: drop
Program+Allocator (self_cell/Send machinery) after the per-file pass,
RETAIN path + source text + facts (emission's dependency is source, not
AST). Reversal criterion recorded verbatim for row 12: "if row 05
emission or row 07 theme/QuickJS demonstrates a need for node-level data
not capturable as a per-file fact — document the exact node and read
site — the self_cell store returns."
Decide: spawn row 12 (store shrink) gated on external:v2-tree-committed
(the falsified-but-reference-quality design must exist in history before
deletion; committing is the USER's action under the repo's no-mutative-git
rule for agents). Rows 05-08 remain lazy on their DEF signals. Act:
DEF-4 flipped; D4 status recorded; row 11 ticked citing this entry;
row 12 spawned.

### 2026-07-13 01:26 · inc 12 · spawn
Row 12 added: store shrink — delete self_cell/Send machinery, retain
{path, source, facts} per file; per-task arenas die at per-file-pass end.
Gated inputs: external:v2-tree-committed. Carries the reversal criterion
verbatim (reorientation above). mode:inline, review:self (mechanical
deletion against a recorded criterion).

### 2026-07-13 01:40 · envelope · signal
DEF-2's resolving signal fired by running the spike: string_wizard 1.1.5
added to the v2 crate (features: sourcemap) and exercised against
animus's three edit shapes — chain-span replacement, import prepend,
consumed-import removal — plus composition, sourcemap emission
("mappings" non-empty), and exact byte-preservation of untouched spans
(4 tests, 131 crate total). Dependency weight: light (memchr +
oxc_sourcemap/oxc_index + base64-simd — the same transitive shape
rolldown ships); G7's direct-dependency grep unaffected. VERDICT:
depend on the published crate; vendoring and in-house both rejected
(API fits natively; the crate is rolldown-maintained). Row 05 flips
lazy → live.

### 2026-07-13 01:55 · envelope · signal
DEF-1's second signal half fired (the call-pattern grep; the harness
landed at inc 02): production consumers call exactly FOUR natives —
vite: analyzeProject×6, clearAnalysisCache×6, loadSystemModule×2,
transformFile×2; next: analyzeProject×5, clearAnalysisCache×5,
loadSystemModule×2, loader transformFile×2. NO plugin or pipeline code
calls `extract()` — its only consumers are the 197 canary tests, so v2
can omit it behind a canary adapter exactly as DEF-1 anticipated. Row 06
(NAPI surface: stateful handle owning analyze/transform/loadSystem, the
multi-compiler ownership topology, per DEF-1's expanded scope) is now
creation-licensed; it remains lazy until its packet is authored at the
next stretch. The v1 engine-flip topology note (RF-28, process-global
singleton) rides with it.

### 2026-07-13 02:10 · inc 05 · objection
Compact reviewer (live-verified tests + G3 command + string_wizard crate
source) returned PROCEED-WITH-OBJECTIONS. Dispositions:
(RF-41, BLOCKING) apply_plan discarded string_wizard's Result — silent
edit loss on overlapping/invalid spans, the exact class G5 bans. FIXED:
apply_plan returns Result with span-identified errors; overlap test
proves loud failure; plan invariants documented. 133 crate tests.
(RF-42) sourcemap claim scoped honestly: generation WIRED; positional
correctness proof rides with DEF-3 (doc + packet updated).
(RF-43) G3 recorded-result mismatch (comment hits) — register regex
refined to code-shaped `\.replace_range\(`; control re-fires on v1
(10), gate truly empty on v2.
(RF-44) dep-weight CORRECTION: string_wizard also pulls `regex` (+
regex-automata, regex-syntax, aho-corasick) — heavier than the
enumerated set; DEPEND verdict unchanged but the record now weighs it.
(RF-45) UTF-8 byte-index compatibility pinned by a multi-byte test.
(RF-46) heretic: oxc_sourcemap enters only via string_wizard, no type
crossing (map → JSON string immediately) — independent versioning per
rolldown precedent; co-bump folded into DEF-8's scope.

### 2026-07-13 02:12 · inc 05 · reorientation
Observe: emission mechanism landed with loud-failure semantics (Result
propagation, overlap detection), three edit shapes + composition +
byte-preservation + multi-byte pins, sourcemap wired (correctness proof
deferred with DEF-3); DEF-2 resolved (DEPEND, with corrected weight
evidence); 133 crate tests; G3 refined + recalibrated; parity gate
unaffected. Orient (off-beat, entropy): the BLOCKING catch repeats the
change's central lesson — silent-swallow is the enemy — this time in
NEW code, proving the review cadence pays on green-looking increments
too. Footprint clean (standalone crate lockfile). Decide: tick 05;
next stretch owns row 06 (creation-licensed, DEF-1 signals fired) and
the cross-file-phase row (owed oracle/engine debts, RF-36/37); row 12
awaits external:v2-tree-committed. Act: row 05 ticked citing this entry.

### 2026-07-13 02:30 · inc 06 · friction
Task 06.1 landed mid-stretch (ExtractEngine handle: per-instance state,
retained facts+sources, fail-loud contracts; 137 crate tests; Node probe
green). Remaining 06 tasks are each substantial: 06.2 engine-side
cross-file fact algebra (delete the oracle's TS mirror after
property-testing against it), 06.3 emission-plan assembly (config
payloads need class-name hashing + quirk-parity import handling), 06.4
harness rewiring (v2 joins the compare engine set — first REAL v1-vs-v2
scoreboard rows). Packet is current and cold-startable at the 06.1/06.2
boundary.

### 2026-07-13 02:50 · inc 06 · friction
Task 06.2 landed: cross_file.rs — the engine now computes global names,
class resolvers, member bindings, per-file alias augmentation,
unconditional asClass/slot rendering, and variant/state configs from
facts (4 new tests, 141 crate total); engine.analyze() returns
crossFile alongside files; the oracle now CONSUMES engine output (its
TS mirror deleted — RF-37 discharged for rendered semantics) and stays
green across all 35 units. System-prop maps remain config-dependent and
ride with row 07's inputs, as the packet records. Next: Task 06.3
(emission-plan assembly — class-name hashing + v1 replacement-text
shapes + quirk-parity import handling).

### 2026-07-13 03:10 · inc 06 · friction
Task 06.3 core landed: ids.rs (FNV-1a class identity — pinned GREEN
against v1 manifest class names for all 110 witnessed components) +
assemble.rs (v1-exact template shapes; inc-01-sorted config JSON for
variants/compounds/states; compound class indexing; fail-loud
NeedsConfig gating for system/props stages pending row 07). 146 crate
tests. Remaining 06.3: import/directive plan assembly (quirk-parity per
the anticipated register entries) + transform_file wiring for the
no-config subset; then 06.4 harness v1-vs-v2 rows.

### 2026-07-13 03:45 · inc 06 · surprise
Task 06.3 COMPLETE with a result beyond the D2 bar: transformed code for
the entire no-config fixture subset is BYTE-IDENTICAL between v1 and v2
(11/11 fixtures; 5 config-gated fail loud by design; tools/code-parity.ts
is the durable gate). Getting there surfaced and encoded three more v1
transform_file semantics: (a) consumed-import stripping targets the
RUNTIME import ('@animus-ui/system' + binding 'animus') when a primary
chain was extracted — project-file imports are NEVER stripped by
transform_file; (b) the strip loop's split/rejoin gains exactly one
trailing newline on newline-terminated sources whenever the strip lists
are non-empty — replicated under the same condition; (c) extension chains
whose parent binding is not a known project component never reach the
manifest and are NOT replaced — mirrored as a survivor filter. Also
ported: v1's substring-grep import decisions (over generated text),
directive movement, and line-based strip quirks — all under the
anticipated register entries. 149 crate tests.
06.4 RE-SCOPED honestly: full harness v1-vs-v2 rows arm when row 07
gives v2 a CSS surface; the code class gates via code-parity.ts until
then.

### 2026-07-13 04:30 · inc 06 · objection
Reviewer (three stances; live-verified all claims and ran TWO independent
probes that found real divergences) returned PROCEED-WITH-OBJECTIONS.
Dispositions:
(RF-47, BLOCKING) survivor semantics diverged on cyclic/cross-file
extensions (v1 drops provenance cycles; v2 replaced both cyclic chains —
witnessed) — FIXED: transform gates extension chains by walking the
extends_from graph (cycles/unresolvable → dropped exactly like v1;
RESOLVED extension chains fail loud pending the chain-merger port, never
emitting child-only configs). Cyclic-extension multi-file unit now
byte-matches v1.
(RF-48, BLOCKING) directive/EOF quirk conditions — v1 strips ONE blank
line after a moved directive, and its +1-newline quirk keys off the
POST-REPLACEMENT text — both FIXED (directive removal span extended;
quirk basis switched to the pre-prepend emission), with two new corpus
fixtures (use-client-blank-line, no-eof-newline) pinning them.
(RF-49) code-parity extended to MULTI-FILE units (parity corpus dirs) —
the blindness that hid RF-47; now 29 files byte-equal, 6 gated loud
(config/merge/compose), DIFFS=0 across 37 units.
(RF-50) compose files now gate loud (own row) rather than emitting
without their replacement. (RF-51) cross-file facts cached on the handle
at analyze() (per-transform recomputation was an O(files²) smell).
(RF-52) two-instance isolation test added (150 crate tests) — DEF-1's
topology evidence is now tested, not asserted; next-plugin TS wiring and
real-plugin vitest coverage recorded as integration debt riding with the
flip rows. (RF-53) prefix + runtime-import hardcodes named as explicit
row-07 gaps (options struct); code-parity is structurally blind to them
until then. (RF-54) 06.4 capsule claim amended: engine-run v2 wiring
arms with row 07 CSS; G5 evidence lives as Rust crate tests + Node
probes, not the register's named TS file — register command to be
updated at the row-07 boundary.
(RF-55, heretic) quirk-shed criterion recorded VERBATIM: quirks are shed
when v1 leaves the oracle set — after the engine flip plus one full
green cycle of verify:next/vite/showcase against v2 output — each
known-quirk register entry then flips to an intentional-correctness
follow-up and the byte gate re-baselines on v2 snapshots; earlier
shedding is licensed per-quirk when a quirk causes a consumer-fixture
failure (use-client-comment is the standing first candidate,
post-flip).

### 2026-07-13 04:32 · inc 06 · reorientation
Observe: row 06 complete — stateful per-instance handle (isolation-
tested), engine-side cross-file algebra (oracle consumes it), byte-
identical transformation for every comparable corpus file (29/29 across
37 units incl. multi-file; 6 deferred surfaces gated loud), class
identity corpus-pinned, quirk semantics encoded with fixtures. 150 crate
tests; both oracles green; PARITY GATE PASS.
Orient (FULL pass): falsifier's probes caught two real divergences the
gate was structurally blind to — the lesson is now mechanical: EVERY
parity claim needs multi-file units and quirk-shape fixtures in its
corpus, not just the happy singles. Entropy: DEF flips scoped to tested
evidence; capsule amendments recorded. Heretic: quirk replication
AFFIRMED pre-flip with the shed criterion recorded (RF-55).
Decide: flip DEF-1 (per-instance handle; extract() omitted; canary
adapter deferred until needed; topology tested in-crate, plugin wiring
rides with flip rows) and DEF-5 (facts as JSON-once per analyze;
sources Rust-resident; per-file transforms carry zero manifest payload).
Next: row 07 (theme/config/QuickJS — unlocks the 6 gated surfaces and
harness CSS rows) is the last major spine arc; row 12 remains on
external:v2-tree-committed. Act: rows flipped; row 06 ticked citing
this entry.

### 2026-07-13 04:40 · envelope · signal
DEF-11's resolving signal is HALF-fired: DEF-1 resolved (inc 06) ✓; the
G-SEAM battery (transform-evaluation-contract's recorded-expectation
suite over both v1 evaluator paths) remains — it is row 07's natural
ENTRY TASK rather than a separate precondition, since the battery's
recorded expectations against v1's QuickJS and TS-placeholder paths are
exactly the bug-compat contract the evaluator port must satisfy. Row 07
(theme/config/QuickJS — the last major spine arc: unlocks the 6 gated
transform surfaces, v2 CSS, full harness v1-vs-v2 rows, and the
prefix/runtime options struct) is packet-authorable at the next stretch.

### 2026-07-13 05:10 · inc 07 · friction
Task 07.1 landed: G-SEAM battery (tools/seam-battery.ts + committed
seam-baseline.json, 14 cases, round-trips green). Characterization
results now RECORDED as the port contract: fontSize 14 → 0.875rem
(config rem transform); string passthrough; **JS dtoa threshold
captured** (1e16 → '10000000000000000', 1e21 → '1e+21'); 1.50 → '1.5';
negative scale → '-0.5rem'; scale keys 8 and '8' both hit the scale
('0.5rem') but **'8.0' passes through raw** ('padding: 8.0'); raw \r
passes SILENTLY into CSS ('content: \r' — the known swallow, now
baselined); and a scope-refining surprise: **.props() transforms
(inline AND named) take the runtime CSS-variable route even for static
JSX values** — width: var(--animus-w) with zero diagnostics even for a
THROWING transform, because build-time QuickJS evaluation is confined
to CONFIG-level scale/group transforms. Cross-file createTransform
collision: static usage emits raw utility ('left: 3') — named
transforms are runtime too. DEF-11 resolution material complete:
QuickJS is v2's reference for the build-time (config-transform) seam;
the TS-placeholder path dies with extract(); the runtime-var route is
EMISSION semantics (dynamicPropConfig payloads), not build-eval.
First case revision recorded: bare chains were prod-eliminated (no JSX)
— battery cases must render; fixed before recording.

### 2026-07-13 05:45 · inc 07 · surprise
Task 07.3's prefix gate exposed a v1 characterization gap: analyzeProject
with prefix='zz' (positional arg 9 per the documented signature) emits
`animus-` class names in BOTH css and code — the arg appears INERT on
this path under the corpus config, while next-plugin documents a working
prefix option. Either the arg position drifted from the docs or prefix
plumbs only via another surface (emitter config / plugin path). v2's
EngineOptions.prefix is IMPLEMENTED and unit-consistent (zz-… appears
everywhere in v2 output) but its cross-engine parity is UNPINNED until
v1's actual plumbing is verified against source — assigned to the
row-07 reviewer/next stretch. Default path unaffected: code-parity
remains DIFFS=0 (29 byte-equal / 6 gated).

### 2026-07-13 05:46 · inc 07 · friction
Tasks 07.1-07.3 landed this stretch: seam battery + baseline (14 cases);
evaluator ported VERBATIM with v1's tests green (154 crate tests;
rquickjs adds the same bindgen/C-QuickJS weight v1 carries); EngineOptions
(prefix/runtimeImport/cssModuleId) threaded through analyze-time class
identity and transform-time emission with v1 defaults. Remaining:
07.4 theme/scale resolution, 07.5 CSS generation (the ~3,700-line
adaptation core), 07.6 unlock+arm. Packet current; cold-startable at the
07.3/07.4 boundary.

### 2026-07-13 06:20 · inc 07 · friction
Tasks 07.4 + 07.5 (port halves) landed in two moves: theme.rs
(theme_resolver VERBATIM, 1722 lines — compiled first try, zero oxc
surface; 43 tests) and css.rs (css_generator VERBATIM, 1984 lines;
camel_to_kebab inlined with v1's EXACT body after my first inline
differed on leading-uppercase — caught by the verbatim-port discipline
itself; DynamicPropMeta mirrored with BTreeMap scale_values per the
row-09 determinism class; 28 tests). 225 crate tests. The v2 crate now
holds ALL FIVE major v1 ports under verbatim test contracts: chain
walker, evaluator, JSX scanner, theme resolver, CSS generator — 183
ported v1 tests green. Remaining 07.6: pipeline assembly over facts
(resolve stage facts → ResolvedStyles → @layer sheets on the engine),
config-input plumbing (ungate system/props), harness CSS arming — the
wiring that turns the ported organs into a breathing pipeline.

### 2026-07-13 06:55 · inc 07 · friction
07.6 first block landed: pipeline.rs — v1 process_chain's post-eval half
mirrored over ChainFacts (styles/variant-with-base-merge/compound/states/
system-group-expansion/props-with-capture-injection), consuming evaluated
stage VALUES with zero parses; 3 integration-style tests exercise theme
scale resolution, merge ordering, and group expansion (228 crate tests).
The remaining 07.6 sub-blocks are now precisely enumerable:
(i) reconciler/usage-ledger port — generate_css_sheets_ordered consumes
RECONCILED usage, so sheet assembly needs it; (ii) EngineOptions data
inputs (theme/variableMap/contextualVars/config/groupRegistry/aliases
JSONs) + analyze orchestration (per-chain pipeline → generation) + the
v2 CSS surface; (iii) css-parity tool vs v1 corpus-wide; (iv) ungate the
config surfaces + arm harness CSS rows. Also still open in-row: the
transform-extractor port (createTransform files stay loud-gated) and the
prefix characterization question (journal 05:45).

### 2026-07-13 07:55 · inc 07 · observation
07.6 CSS surface LANDS. Ports: reconcile.rs (v1 reconciler verbatim, 14
tests), chain_merge.rs (topo + merge, 20 tests), transforms.rs (v1
transform_extractor verbatim; oxc facade paths, 0.139 `diagnostics`
field; the `const __x = <fn>;` wrapper parse is NOT counted — parseCount
counts file parses only, not a parity surface). facts.rs now extracts
createTransform declarations per file (alias bindings from import
facts). pipeline.rs + analyze_css.rs reimplement v1 process_chain (post-
eval half) + Phases 3–6 over FACTS: extension provenance from direct
relative imports/same-file (v1's re-export following journaled as a
divergence risk), topo sort w/ v1's cycle degradation (lexical filtered
set), SILENT drop of eval-failed chains (v1 967-969 — no diagnostic;
quirk recorded), usage scans via the property-tested fact filters (no
re-parse), inline-transform force-dynamic, utility/custom generation,
ledger + unconditional rendered + compose shared-key pre-population,
reconcile (dev prospective mirror), sheet assembly + variants
sublayering. Engine: EngineOptions gains
theme/variableMap/contextualVars/config/groupRegistry/selectorAliases
JSONs + devMode (parsed fail-loud at construction); analyze retains
INPUT ORDER (rayon indexed collect preserves it) because registration
collisions and utility first-wins dedup are order-sensitive; manifest
gains css/sheets/diagnostics/reconciliation. 271 crate tests.
RESULTS: css-parity (new tool) — 27/27 units byte-equal on FIRST run,
all 8 sheets; non-vacuity proven (10.6KB v1 CSS; per-sheet positive
controls: base 13, variants 3, compounds 1, states 2, system 3, custom
1). seam-battery --engine v2: 14/14 match the v1-recorded baseline
(exponents, raw passthrough, \r, negation, inline/named transforms,
cross-file collision last-wins, throwing transform).
Infra friction: stale cargo sparse-index cache pinned oxc_codegen at
0.124 — cleared ~/.cargo/registry/index/*/.cache/ox to unblock the
semantic/transformer/codegen features.
Remaining in 07.6: transform-side ungate (assemble NeedsConfig →
config-fed emission; code-parity needs-config=6 → byte-equal), engine-
run v2 adapter + scoreboard rows (RF-54), compose-CSS corpus gap check.

### 2026-07-13 08:40 · inc 07 · observation
07.6 COMPLETE — the full scoreboard is armed and GREEN. Sequence after
the CSS milestone: (1) transform-side ungate — assemble.rs gained
ReplacementPayload (system_prop_names/groups, has_dynamic_props,
customPropMap, customDynamicConfig) with v1 build_runtime_config's
verbatim string-splice tail; analyze_css builds payloads per survivor
(Phase 5c/6 mirror); engine.transform_file injects them by binding —
absent payload = pipeline-dropped chain = not replaced (v1 silent-skip
parity). (2) Full import block: virtual system-props imports +
dynamicPropConfig transform-rebinding loop + compose-context import,
v1 order. (3) Extension merged-config emission: harness corpus proved
the "later row" gate untenable (NavLink); evaluated entries now carry
post-merge compound configs (parent-first, parent class names) and
extension children get MergedChainConfig (variants/states derive from
the merged ComponentCss — same merge, one source of truth). (4) Compose
emission pulled forward for the same reason (composition.tsx):
createComposedFamily(WithContext) at facts spans, literal
'@animus-ui/system(/compose*)' consumed-source strings (quirk parity),
'use client' injection for context families. RESULTS: code-parity
35/35 byte-equal, needs-config=0; harness v1-vs-v2 BOTH modes PASS —
0 unregistered divergences; the 6 reported are the REGISTERED
css-validity known-quirks firing identically on BOTH engines (v1's
unresolved-alias leak, faithfully reproduced). verify:parity is now a
3-leg tier: self-check → seam-battery (both engines, promoted to
packages/_parity/tools/) → v1-vs-v2 differential both modes. 273 crate
tests. Infra: fmt ignore for _parity/corpus/** (byte-precise fixtures)
+ generated v2 loader surface. Anticipated-divergence note: v1 builds
custom slot entries from a HashMap values() iteration (per-process
order); v2 iterates sorted_ids — a multi-component custom-prop unit
could order-diverge inside @layer custom (rule-order class). Corpus has
one custom unit (identical); registering as anticipated.

### 2026-07-13 08:45 · inc 07 · quirk
v1 analyze SILENTLY drops chains whose process_chain errors (lib.rs
consumer at project_analyzer 967-969 — Err arm is an empty block, no
diagnostic). v2 analyze_css mirrors (silent skip; transform then skips
non-survivors). Recorded here because it contradicts the "any stage
error is chain-fatal WITH diagnostics" reading — the chain dies, but
the manifest never says so. Post-flip correctness candidate.

### 2026-07-13 09:05 · inc 07 · reorientation (FULL)
First full-pipeline v1-vs-v2 scoreboard is in hand — the three stances
interrogate what it actually proves.

**Falsifier** — what would disprove "spine parity-complete"?
(a) Corpus blind spots: no resolved-extension unit in the change-local
code-parity enumeration (harness corpus has NavLink; keep both); no
multi-component custom-prop unit (the anticipated @layer custom
slot-order divergence is UNWITNESSED either way); composed-variant CSS
(compose shared-key sublayer content) may be empty across every unit —
if so that generator path is green-by-vacuity. (b) Extension parents
reached via re-export barrels: v1's import_resolver follows them, v2's
direct-relative resolution drops the child (divergence invisible until
a corpus case exists). (c) prefix: v1's analyzeProject arg-9 is
empirically inert, so v2's working prefix has NO v1 oracle — unpinned,
standing reviewer material. Actions: corpus-gap row candidates
recorded; none block row 07 (the register holds the anticipated
entries).

**Entropy auditor** — debt added this row: evaluated's 7-tuple in
analyze_css wants a struct (post-parity cleanup; not now — churn risk
against a green scoreboard). engine-run's observable JSONs became
key-sorted canonical (necessary: v1 serializes several manifest maps
via std HashMap whose order is per-process random) — note the
definition of "identical observables" changed mid-change; snapshots
regenerated green. The three change-local tools (code/css/chain-parity)
are now largely subsumed by the 3-leg verify:parity tier — retire
candidates at archive.

**Heretic** — the corpus is 27-37 adversarial units; the honest oracle
for "flip vite-plugin to v2" is the CONSUMER BUILDS. verify:showcase /
verify:next / verify:vite on engine v2 need: loadSystemModule-fed
EngineOptions (plugins currently feed v1 args), plus the engine inputs
v2 still lacks — globalStyleBlocks, keyframes blocks, selectorOrder.
That is the flip-preconditions row, and it — not more corpus — is the
next real risk reduction. The 07 scoreboard proves the spine; it does
not prove the plumbing.

### 2026-07-13 09:15 · inc 07 · observation
Falsifier follow-up: composed-variant CSS is NOT green-by-vacuity —
probe shows integration/composition.tsx emits non-empty `@layer
composed` content in v1, and that unit is byte-identical in the
differential. Positive control confirmed for the composed generator
path. Remaining unwitnessed: multi-component custom-prop ordering and
re-export extension parents (register/corpus candidates, non-blocking).

### 2026-07-13 10:20 · inc 07 · review
Two Fable reviewers (semantics-vs-v1; gate integrity). Both found real
defects — every blocking finding fixed and re-verified same session.

SEMANTICS (8 blocking): (F1) one-arg .compound(cond) emitted a runtime
config v1 never emits AND skewed --compound-N numbering — config+index
now gated on second_value (v1 lib.rs 536-554) in both assemble and the
merged-config build. (F2) engine.transform_file's binding-name ancestry
re-walk contradicted analyze_css's provenance (aliased parent imports
silently lost their replacement while their CSS emitted) — the walk is
DELETED; payload presence is the survival record. (F3) provenance
divergence classes beyond the journaled re-export gap: probe order now
v1's exact (.ts before .tsx, /index.js(x) included); the parent-must-
be-a-chain filter dropped (v1 keeps children of dangling parents
STANDALONE — topo external root); default-import facts added (parent →
`file::default` dangling root). Package-specifier/path-alias parents
remain out (engine lacks packageResolution/pathAliases inputs — flip-
preconditions row). (F4) props-serde-rejected chains stripped the
runtime import while leaving the chain live — has_primary_extracted now
keys off payload presence (v1 manifest membership), not fatal_error.
(F5) compose-only files: v1 returns UNCHANGED when the file has no
surviving components (lib.rs 950-958, BEFORE compose handling) — v2
now mirrors the gate. (F6/F7) the directive blank-line strip and
trailing-newline quirk were REPLAYS on the wrong text basis — replaced
by v1's actual order: span replacements → VERBATIM strip_consumed_
imports (the split/rebuild loop that IS the quirk) → directive tail on
the post-strip string. The span-model consumed_import_removals/
directive_and_imports remain as tested reference models but are off
the production path. (F8) reverse_provenance now filtered to evaluated
survivors. Verdicts that checked out: payload splices byte-identical;
consumed/strip lists exact; transforms.rs verbatim; slot-order
neutralized by the generator's total sort.

GATE INTEGRITY (4 blocking): (G1) selectorOrder asymmetry — resolved
by EVIDENCE, not plumbing: v1 parses selector_order into an
underscore-DISCARDED binding at both entry points (lib.rs:113, 859);
it is dead end-to-end in the engine while SystemBuilder advertises it.
Registered as v1-feature-drift; v2 stays input-free deliberately. (G2)
v2 was never self-checked and the thread leg was dormant — parity.sh
now runs v1 self-check, v2 self-check, AND v2 --threads 1,8, plus
--parse-count on the differential. (G3) vacuity-capable exits — unit
floors added to engine-run (30) and both change-local tools (25);
code-parity additionally fails on ANY needs-config post-row-07. (G4)
EVIDENCE INTEGRITY: the entire v2 crate, packages/_parity, parity.sh,
index-v2.js and this change directory are UNTRACKED — no baseline has
provenance until committed. Agent is forbidden from git mutations;
this is the external:v2-tree-committed gate (row 12 input) now also
blocking evidence pinning for row 07's claims. USER ACTION REQUIRED.
Advisory fixes: --record pinned to v1 (tautology guard). Register +3
(duplicate-compose intentional-correctness; selectorOrder drift;
slot-order note). All gates re-verified post-fix: crate 273; v1 280;
code-parity 35/35 needs-config=0; css-parity 27/27; battery 14/14×2;
5-invocation parity tier PASS incl. thread determinism.

### 2026-07-13 10:25 · inc 07 · decision
Row 07 TICKED. DEF-11 resolved (QuickJS reference; TS-placeholder path
dies with extract()). The v2 spine now reproduces v1's full pipeline —
analyze (facts → theme → CSS → manifest observables) and transform
(replacements incl. system/props payloads, extension merged configs,
compose emission, verbatim import strip + directive semantics) — with
every parity surface green after two-reviewer scrutiny: crate 273; v1
280; code-parity 35/35 needs-config=0; css-parity 27/27; seam-battery
14/14 both engines; 5-invocation verify:parity tier PASS (v1 + v2
self-checks, v2 thread-variation 1-vs-8, battery ×2, differential both
modes with parse budget). Spawn candidates carried forward:
flip-preconditions row (plugin option-feeding via loadSystemModule;
globalStyleBlocks/keyframes/selectorOrder/packageResolution/pathAliases
engine inputs; consumer builds on engine v2); corpus-gap rows
(re-export extension parent, multi-component custom props,
duplicate-compose); row 08 (DEF-7 watch/incremental) now the sole
non-external open row. EXTERNAL: the untracked-tree evidence gate
(review 10:20 G4) needs a user commit before row 12 and before any
claim of pinned baselines.

### 2026-07-13 10:35 · registry · decision
Row 13 (flip-preconditions) AUTHORED from the 07 heretic material +
review residue: engine input completion (global blocks, keyframes,
packageResolution, pathAliases — NOT selectorOrder, which is dead in
v1), plugin v2 legs, consumer-build oracle, DEF-7 resolution by
measurement (expected: no cache needed at ~50ms/62-file scale), and
the seven review-witness corpus units. deps: 07 · inputs: 07. Row 08
stays lazy pending DEF-7's numbers from 13.4.

### 2026-07-13 10:50 · inc 13 · friction
Task 13.1 opening read surfaces a STRUCTURAL gap, not just missing
inputs: v1 Phase 2b (project_analyzer 570-615) enriches each file's
static-value map BEFORE chain eval with (a) imported consts resolved
through the binding map to source files' static-export maps and (b)
keyframes-collection bindings from the keyframes registry (Phase 2a,
551-567 — built from keyframes_blocks JSON, feeding
`animationName: motion.ember` substitution). v2 evaluates chains
EAGERLY at parse time with SAME-FILE statics only (the D4 outcome's
hidden cost — no corpus fixture imports a const or keyframes binding,
so every differential stayed green). Consequence for v2: single-pass
eager eval cannot be correct for imported statics. Resolution shape:
TWO passes over the SAME AstStore lifetime (no re-parse, G1 intact) —
pass A collects statics/exports/imports per file, engine builds
binding-resolved static maps (+ keyframes registry from a new
keyframesJson option), pass B extracts chain facts with the enriched
statics. Also needed from the same read: v1's resolve_path order for
provenance/binding resolution is relative → expand_alias+probe →
package-map lookup (project_analyzer 528-536; AliasEntry
{pattern, replacement, type: exact|prefix} tried in caller-sorted
order). Corpus additions must include an imported-static unit and a
keyframes unit — both are FALSIFIERS for the current green.

### 2026-07-13 11:30 · inc 13 · observation
Task 13.1 LANDS. (1) TWO-PASS FACTS: engine.analyze now runs pass A
(statics/imports/exports per file over the live AstStore — zero new
parses) building static-export maps + the keyframes registry (v1 Phase
2a verbatim shape), then binding-resolved per-file enrichment (v1
Phase 2b: imported consts + keyframes bindings; injection gated on the
source file actually EXPORTING the name, mirroring the binding-map
hit), then pass B chain facts with enriched statics
(extract_file_facts_enriched). (2) INPUTS: EngineOptions gains
globalStyleBlocksJson/keyframesJson (wired to
resolve_all_global_blocks/_keyframes_blocks → sheets.global, v1
1708-1736) and packageResolutionJson/pathAliasesJson (AliasEntry/
expand_alias v1-verbatim; resolve order relative → alias+probe →
package-map-unconditional; probe order v1-exact). v1's silent
alias-parse failure is a LOUD error in v2 (G5). (3) FALSIFIER UNITS:
corpus/imported-static (cross-file const into ds.styles — the exact
case the pre-13 green never witnessed) and corpus/keyframes-import
(registry-resolved animationName); the harness now feeds synthetic
globalStyleBlocks + keyframes JSON SYMMETRICALLY to both engines
(test-system exports neither), exercising global-sheet resolution
corpus-wide including a {fonts.base} token alias. RESULTS: 39 units,
both dev modes, 0 unregistered divergences; 277 crate tests; 5-leg
verify:parity PASS; lint/compile green. Note: v1's arg-9 is
emitter_config_json (not a bare prefix) and analyze() hardcodes
"animus" (lib.rs:899) — the prefix-inertness question from 07 is now
fully explained: prefix rides EmitterConfig for emission only, class
identity is hardcoded. Remaining in row 13: plugin v2 legs (13.2),
consumer-build oracle (13.3), DEF-7 numbers (13.4), remaining review
witnesses (13.5).

### 2026-07-13 11:50 · inc 13 · observation
13.2 scoping: the plugins consume these v1 manifest fields (snake_case)
— system_prop_map, dynamic_props, components (id → ComponentDescriptor
w/ file/binding/class_name/extends_from/terminal/tag/replacement/
system_prop_names), files (path → [component_ids]), timing, report
(next-plugin), css/sheets, plus whatever the grep above shows for
use_client_files/compose_replacements/global_css. v2's analyze JSON is
camelCase and lacks components/files/report-alias/timing — 13.2's Rust
half is emitting a v1-key-compatible manifest surface from analyze_css
(all data already computed: chain_lookup + evaluated + replacement
payloads + generate_replacement text for descriptors; files map;
reconciliation → report). TS half: vite-plugin/next-plugin v2 legs
construct a PER-PLUGIN-INSTANCE ExtractEngine (DEF-1 — no module-level
facade) from loadSystemModule output (loadSystemModule STAYS a v1 NAPI
call), route analyze/transform/clear through the handle, and read the
same manifest fields. Then 13.3 consumer builds.

### 2026-07-13 12:20 · inc 13 · observation
13.2 Rust half: v2's analyze() manifest now carries the PLUGIN-CONSUMED
surface under v1's EXACT serde names — css, sheets, diagnostics,
report, system_prop_map, dynamic_props, component_fragments,
reverse_provenance, components (full ComponentDescriptor incl.
generate_replacement text + system_prop_names from payloads), files
(path → survivor ids), timing:{parseCount} — while v2-native fields
stay camelCase (fileFacts — RENAMED from `files` to clear the v1-name
collision — crossFile, parseCount). Field inventory: the plugins read
exactly those eight v1 fields and nothing else (grep witnessed;
use_client_files/compose_replacements/global_css/utilities/usage/
provenance are unconsumed). All parity surfaces re-verified green
(differential 36/39 prod + 35/39 dev with ONLY the registered
known-quirk rows — an earlier mis-sample of the 5-leg output made the
quirks look vanished; direct probe re-confirmed the v1 leak and the
snap carries the rows). 277 crate tests. Next: TS plugin legs —
per-plugin-instance ExtractEngine (DEF-1) fed from loadSystemModule
output; then 13.3 consumer builds.

### 2026-07-13 12:55 · inc 13 · observation
13.2 + first 13.3 leg LAND. (1) v2 manifest re-keyed to the plugin
surface (journal 12:20). (2) vite-plugin v2 leg: engineApi() adapter at
the single choke-point maps the v1 function API onto a PER-PLUGIN-
INSTANCE ExtractEngine (DEF-1); loadSystemModule stays v1 (engine-
independent); all five call sites engine-agnostic. (3) NAPI FOOTGUN
found by the first real v2 build: #[napi(object)] Option<String> fields
accept `undefined` (→None) but REJECT `null` with "Failed to convert
Null into String" — the fixture's null globalStyleBlocks killed
analyze, caught-and-warned into an EMPTY stylesheet (the verify:true
self-check DID flag it: "No component CSS produced"). All JS adapters
now pass undefined. (4) ORACLE RESULT: e2e/vite-app built with
ANIMUS_ENGINE=v2 is BYTE-IDENTICAL to the v1 build — dist diff clean
(JS, CSS asset, HTML), and assert-vite positional assertions pass on
the v2-built output. The fixture's vite.config selects the engine via
ANIMUS_ENGINE so the same fixture proves both legs. Remaining 13.3:
showcase + next-app parameterization and builds (next-plugin v2 leg
still unwired); then DEF-7 numbers (13.4) and review witnesses (13.5).

### 2026-07-13 13:15 · inc 13 · observation
SHOWCASE ORACLE GREEN: packages/showcase (62 files — MDX, compose
families, extensions, system/custom props, keyframes, global styles)
builds BYTE-IDENTICALLY on engine v2 (dist diff clean vs the v1 build);
assert-showcase positional assertions pass on the v2-built output.
Together with the vite-app result (12:55) this is the flip-precondition
evidence for the Vite pipeline: same fixture, same config, engine
selected by ANIMUS_ENGINE, identical artifacts. Remaining oracle:
next-app — requires the next-plugin v2 leg (unwired) AND is blocked by
the PRE-EXISTING verify:next breakage (typescript package removed in
the tsgo migration; task chip already spawned for the user). DEF-7
timing (13.4) and review-witness corpus units (13.5) remain.

### 2026-07-13 13:30 · inc 13 · decision
DEF-7 RESOLVED BY MEASUREMENT (Task 13.4). Showcase scale (54 source
files, real system config, dev mode): v1 cold analyze 15.3ms, v1
re-analyze with WARM content-hash cache 10.7ms; v2 cold 22.3ms, v2
re-analyze with NO CACHE AT ALL 9.8ms. The parse-once fact
architecture makes v2's uncached full re-analysis FASTER than v1's
cache-hit path — the entire watch/incremental problem v1's caching
machinery exists to solve (content hashing, per-file result caches,
cache eviction, the RF-28 stale-cache bug class) is deleted, not
optimized. DEF-7 resolution: v2 ships with NO incremental cache;
analyze() is the HMR unit. Row 08 closes as SUBSUMED by this
measurement — if an order-of-magnitude-larger consumer ever pushes
re-analysis past the dev budget, the reversal is a NEW row with these
numbers as its baseline.

### 2026-07-13 13:55 · inc 13 · observation
Task 13.5 (partial): FOUR review-witness corpus units land, each
pinning an inc-07 review fix against the LIVE v1 oracle —
one-arg-compound.tsx (F1: config+index gated on the styled arg),
props-serde-reject.tsx (F4: silently-dropped chain keeps its runtime
import), compose-only/ (F5: no-survivor file passes through unchanged,
compose call and all), eof-consumed-import.tsx (F7: consumed-import-at-
EOF-no-newline strip corner). Differential: 43 units, both modes, 0
unregistered. NOT added (deliberately): re-export extension parent,
duplicate-compose, multi-component custom props — each would ACTIVATE
a registered-but-anticipated divergence (v2 gap or v2-correct
behavior); they belong to the follow-up row that either implements
re-export following or flips those register entries to active with
intent. Residue for that row: next-plugin v2 leg + next-app oracle
(blocked on the pre-existing verify:next typescript breakage — user
task chip).

### 2026-07-13 14:30 · inc 13 · observation
Continuation block closes the deferred residue. (1) RE-EXPORT FOLLOWING
implemented — ExportFact gains source/original; follow_reexports hops
`export { X as Y } from '...'` chains (cycle-guarded) in BOTH
provenance resolution and the pass-A statics/keyframes enrichment,
mirroring v1's binding_map. The reexport-parent corpus unit (barrel →
extension parent) is IDENTICAL across engines — the inc-07 F3 gap is
CLOSED, not registered. (2) multi-custom.tsx lands identical (the
generator's total sort neutralizes slot order, as the semantics
reviewer verified). (3) duplicate-compose.tsx ACTIVATES its
intentional-correctness register entry (v1 double-replaces the first
span with mangled output; v2 emits each family at its own span — v2
correct, entry sheds at flip). Differential: 46 units, both modes,
0 unregistered. (4) NEXT-PLUGIN v2 LEG wired: singleton engineApi()
adapter (engine instance on globalThis alongside the manifest — the
next-plugin is process-singleton by existing design); plugin.ts +
loader.ts route through it; compile/lint/unit green. The next-app
ORACLE stays gated on external:verify-next-repaired (pre-existing
typescript-package breakage, user task chip) — recorded as a row-13
inputs token; everything else in the row is done. Task 13.5 COMPLETE
(all seven witnesses landed or intentionally activated).

### 2026-07-13 15:20 · inc 13 · observation
EXTERNAL GATES CLEARED BY USER (commit 88a44ce) + verify:next repair
authorized and DONE: `typescript@^5.9.2` added to e2e/next-app
devDependencies ONLY (Next requires the package to load
next.config.ts and its yarn auto-install fails under the corepack
field; the root stays typescript-free per the tsgo migration).
verify:next + assert-next green. NEXT ORACLE: fixture parameterized
via ANIMUS_ENGINE like the Vite pair; v2 build green, assert-next
passes, and the EXTRACTED CSS IS BYTE-IDENTICAL across engines (9,779
bytes; .next output itself is not byte-deterministic, so CSS payload +
positional assertions are the oracle). All THREE consumer fixtures now
prove the v2 engine. BONUS FALSIFIER (user question): multibyte.tsx
corpus unit — 3-byte kana/kanji preamble consts, 4-byte emoji, and a
UNICODE IDENTIFIER (見出し) as the component binding — IDENTICAL
across engines both modes (47 units, 0 unregistered). oxc spans are
byte offsets and every v2 splice is span- or ASCII-delimiter-based, so
char/byte mixing would have sheared every span after the preamble; it
doesn't, and the FNV class hash runs over raw UTF-8 bytes identically.
Crate test pins the exact shape (278 tests). Recurring tooling
self-footgun codified: python '''heredocs''' interpret \n — THREE test
JSONs written with real newlines this session; always write Rust test
JSON via r-strings.

### 2026-07-13 15:50 · inc 13 · decision
SHOWCASE FLIPPED TO v2 BY USER DIRECTIVE ("Flip showcase over and I'll
boot it up") — the first standing v2 consumer. packages/showcase
vite.config now defaults engine:'v2' with ANIMUS_ENGINE=v1 as the
escape hatch; vite-app and next-app fixtures REMAIN v1-default (their
role is the differential, not adoption). Verified before handoff:
prod build + assert-showcase green on the flipped default; dev-server
smoke — boots, virtual:animus/styles.css serves through Vite's HMR
wrapper, and the dev-mode prospective-elimination diagnostics
([animus] ⚠ Alert/Badge/Card would be eliminated in production — the
MDX-indirection scanner blind spot the dev report exists to surface)
flow through v2's identify_prospective_eliminations mirror exactly as
under v1. No errors in the dev log. NOTE for the running row-13
reviewer: the "fixtures stay v1-default" invariant now carries a
user-directed exception for showcase (this entry is the authorization
record).

### 2026-07-13 16:40 · inc 13 · friction
FIRST LIVE v2 DEV SESSION (user-directed showcase flip) finds the
plumbing gap the corpus never could: the plugins' incremental protocol
sends EMPTY SOURCES + content hashes for unchanged files — an implicit
CONTRACT with v1's Rust-side per-file cache ("Rust cache-hit path never
reads file.source", vite index.ts 208-227; same in next plugin.ts
buildFileEntriesFromCache). v2 has NO cache (DEF-7), so an HMR
re-analysis fed it empty sources → empty facts → 520-byte scaffold CSS
→ the unstyled page the browser showed. Diagnosis chain: screenshot →
adopted stylesheet empty → engine outputs proven byte-identical
offline (148KB) AND server-side (151,840 both engines) → components
virtual module 520 bytes v2 vs 726,571 v1 → entry-builder protocol.
FIXES: vite adapter re-hydrates empty sources from the plugin's own
fileCache before analyze; next-plugin's buildFileEntriesFromCache
sends full sources when getSharedEngine()==='v2'. VERIFIED: cold AND
post-HMR components module now 726,571 bytes on v2 (identical to v1);
screenshot shows the showcase fully styled (layered logotype, nav,
mode toggle). DEF-7's resolution STANDS (no cache needed for speed) —
but its blind spot is now explicit: the cache was also a PROTOCOL
PARTY, and deleting it required updating the protocol's other side.
The dev server is running for the user (localhost:5173, engine v2).

### 2026-07-13 17:15 · inc 13 · review
Row-13 close-out review (Fable) CONVERGED with the live session: its B1
(empty-source HMR protocol) is the same defect the user's dev boot
surfaced — found independently by review and by use, fixed before the
review even returned (16:40). All other findings fixed this block:
B2 — CI built only the v1 binary while verify:showcase now needs v2
(non-actionable failure mode): build-extract matrix now builds+uploads
napi-v2-<target>, the verify job downloads it, and build-showcase.sh
gains require_fresh_napi_v2 (fail-loud tier contract restored).
A1 — pass-A enrichment now mirrors v1 follow_export_chain exactly:
entries ONLY when the re-export chain terminates at a LOCAL export,
32-hop cap (dangling hops previously still injected).
A2 — adapters no longer drop EmitterConfig: runtime_import /
css_module_id / system_props_module_id parse through to new
EngineOptions fields (Next's runtime subpath + custom module ids were
being silently rewired to v2 defaults).
A3 — v2 transformFile source-drift now WARNS (v2 emits from
analyze-time sources; an upstream transform between analyze and
transform would be silently reverted — the fixtures' byte-identical
dists prove none exists today).
A4 — stale-engine window closed: v2Engine/globalThis key nulled BEFORE
construction. A6 — harness adapter mirrors caller positions 12/13/14
instead of re-asserting constants; arg-9 relabeled emitterConfig
(review also settled its identity: v1 arg 9 is emitter_config_json).
A5 — stale gap-comments updated. A7 — the row-13 tail is a NEW
uncommitted working set (user commit requested).
Post-fix verification: 278 crate tests; 5-leg parity PASS (47 units,
0 unregistered, both modes); vite-app dist identical; showcase dist
identical (v1 vs the v2 DEFAULT); lint/compile/fmt green; dev server
restarted on the final adapters (components module 726,571 bytes —
byte-equal to v1's). Row 13 TICKED.

### 2026-07-13 18:05 · registry · decision
CHANGE CLOSE-OUT (user directive: capture follow-ons, archive, sync).
DEF-13 RESOLVED: v2 distribution rides the DEFAULT-FLIP follow-on
change — shipping the binary and flipping plugin defaults are one
release event; until then the ./engine-v2 export is repo-internal
(showcase runs it by user directive; e2e fixtures opt in via
ANIMUS_ENGINE). Row 12 retired accordingly. FOLLOW-ONS CAPTURED AS
SPAWN CHIPS: (1) default-flip change — ship v2 binary in the release
pipeline, flip vite/next plugin defaults to v2, decide the A3 residue
(v2 emits from analyze-time sources; warn-only today), retire the
change-local parity tools + the index-v2 fail-loud Proxy, and begin v1
retirement per the arch spec; (2) post-flip quirk shed — the register's
active known-quirks in dependency order: unresolved-alias invalid-CSS
leak (css-validity entries), use-client-comment directive detection,
duplicate-compose v1 mangling (v2 already correct — shed = drop the
register entry when v1 retires), silent eval-drop diagnostics
(2026-07-13 08:45 quirk entry), selectorOrder dead config surface
(SystemBuilder advertises what no engine reads). Final state: 13/13
registry rows closed; 278 crate tests; 5-leg verify:parity PASS (47
units, 0 unregistered, both modes); three consumer oracles green (two
byte-identical dists + next CSS byte-identical); showcase LIVE on v2.
