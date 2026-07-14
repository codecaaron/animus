# Journal: total-dynamic-floor

<!--
Append-only temporal log, seeded at first apply run, written throughout.
Deliberately cheap: 1-3 lines per entry, written at the moment of
observation, never restructured. Newest entries at the BOTTOM (append means
append). Wall-clock may be non-monotonic across sessions — POSITION in the
file, not timestamp, is the authoritative order; never insert or reorder.

Entry grammar:
  ### <timestamp> · <inc NN | envelope> · <type>
  <observation> → <implication or action pointer>

Reorientation entry grammar:
  ### <timestamp> · inc <NN> · reorientation
  - Observe: <entries since last checkpoint; gate results; [~] deferrals>
  - Orient: <outcome vs Ledger predictions · state vs NS<n> · lazy rows vs
    Review-by> — stances run: <full pass | entropy auditor only>, objections:
    <count and evidence>
  - Decide: <explicit disposition per open thread>
  - Act: <Ledger flips, registry edits, north-star revisions applied>

SINGLE-WRITER RULE: only the orchestrating agent appends. Delegated subagents
propose entries in their output contract.
-->

### 2026-07-13 20:27 · envelope · seed
Journal opens at apply start. Envelope-licensed row: 01 (created at propose time); rows 02–04 require their declared external/input or Ledger signals before packet creation.

### 2026-07-13 20:53 · inc 01 · friction
The declared main-relative G4 check is polluted by six pre-existing feature-branch v1 paths; the apply-session HEAD-relative check is empty → revise G4 to the immutable session baseline.

### 2026-07-13 20:53 · inc 01 · reorientation
- Observe: RED proved the silent drop; GREEN focused tests pass 7/7 after strengthening distinct component/prop and responsive serialization coverage; compile, types, and unit:ts pass (209/209); G3 showcase production build passes with no `animus:drop`; G4 HEAD-relative output is empty. [~] DEF-2 has no showcase-dev dogfood signal yet.
- Orient: D2/D4 landed without changing static/dynamic lookup results; NS1 gains an observable terminal branch and NS2 is preserved — stances run: full pass, objections: 3 (falsifier: underdiscriminating dedupe test; entropy auditor: polluted main-relative G4; heretic: module-set policy may be too sticky).
- Decide: accept the falsifier and entropy objections (tests strengthened; G4 baseline revised); retain warn-once Set provisionally and defer escalation until DEF-2's declared dogfood signal.
- Act: mark G3 passed, revise G4 check to HEAD, tick row 01; keep lazy row 04 blocked on DEF-2.

### 2026-07-13 20:55 · inc 02 · signal
`change:extract-v2-default-flip#02` is ticked at 2026-07-13 03:20 and both plugin defaults resolve to v2 (`options.engine ?? 'v2'`) → `external:extract-v2-engine-flip` is fulfilled and licenses row 02 packet creation.

### 2026-07-13 21:19 · inc 02 · measurement
The all-evaluated floor adds 36,167 bytes Next (+392.56%), 121,532 showcase (+84.61%), and 28,269 Vite (+447.15%); shared dynamic props rise from zero to 67/140/67 → DEF-1 resolves to keep custom props lazy and DEF-3 fires the reconciliation-reachability narrowing fallback.

### 2026-07-13 21:19 · inc 02 · reorientation
- Observe: RED/GREEN floor tests pass 4/4, UTF-8 measurement test passes, v2 unit 312/312, hygiene/canary/integration and all three consumer build+assert gates pass; static maps are exactly invariant; custom props remain component-qualified and lazy; G4 is empty. Parity self-check/seam pass, while the committed oracle is intentionally stale pending the licensed narrowing and statics-enrichment output changes. [~] DEF-2 still lacks showcase-dev dogfood.
- Orient: D1/D3 establish totality but the all-evaluated cost breaches NS3 in every consumer; custom totalization would compound the breach — stances run: full pass, objections: 3 (falsifier: overlapping/UTF-8 test discrimination; entropy auditor: stale baseline only during uninterrupted follow-up; heretic: narrow by post-reconciliation survival and widen uncertainty).
- Decide: fix both test gaps; keep custom props lazy; narrow by rendered/provenance/asClass/compose reachability, canonicalize aliases, and widen to the all-evaluated set when identity is uncertain; refresh parity once after all intentional v2 output changes.
- Act: mark G1 passed and row 02 complete; resolve DEF-1/DEF-3; revise D1/NS3/G2; author row 03 packet.

### 2026-07-13 21:46 · inc 03 · surprise
Reachability narrowing preserves the exact row-02 measurements in all three consumers: Next +36,167 bytes (+392.56%), showcase +121,532 (+84.61%), and Vite +28,269 (+447.15%) → current retained components collectively expose every evaluated prop, so the narrowing is a future-dead-component bound with zero present-byte savings.

### 2026-07-13 21:46 · inc 03 · reorientation
- Observe: discriminating reachability tests pass for dead components, import aliases, parents, `asClass`, compose, and uncertainty widening; full v2 passes 326/326, all Rust/canary/integration and three consumer build+assert gates pass, static maps remain invariant, custom props remain lazy, G4 and diff-check are clean. Two Important review objections strengthened independent reachability-source and uncertainty tests; clean re-review approved. [~] DEF-2 still lacks showcase-dev dogfood.
- Orient: G2 and totality hold, but the measured first-party cost is intrinsic to their retained prop universe rather than an avoidable dead-component over-approximation; NS3 is satisfied only as an asymptotic reachability bound — stances run: full pass, objections: 2 Important plus the zero-savings surprise, all correctness objections closed.
- Decide: accept the measured +84.61% to +447.15% cost as the price of total system-prop fallback, retain the narrowing for projects with dead components, keep custom props lazy, and carry DEF-2/row 04 pending its declared dogfood signal.
- Act: mark G2 passed, revise D1/NS3 to record zero current savings and the explicit cost disposition, and tick row 03; the combined parity refresh remains root-owned after prop-flow row 03.

### 2026-07-13 22:31 · inc 03 · review-correction
External review reproduced unresolved member/local-alias renders and raw alias identities escaping the narrowed set; the floor and reconciler could therefore disagree or both prune a possible target → replace the split reachability sets with one canonical policy, widen both on unresolved component-like syntax, and retain native-element controls.

### 2026-07-13 22:31 · inc 03 · reorientation
- Observe: RED covered namespace/member JSX, `createElement` members/dynamic targets, local and renamed unknown aliases, and known alias pruning; every component-like case failed before the correction while lowercase/native controls passed. GREEN passes full v2 334/334 and focused runtime 13/13.
- Orient: the original recognized-binding-only uncertainty rule was narrower than G2 and could re-open NS1 through reconciler pruning; a single canonical rendered set restores the intended conservative upper bound — stances run: full pass, objections: 3 correctness findings (#2, #3, #6), all corrected pending final re-review.
- Decide: widen floor and reconciliation together for every unresolved component-like identity; canonicalize all known usage fields; keep native syntax non-widening and retain the supported full-graph consumer model for exported components.
- Act: strengthen D1/G2 and the delta scenarios; amend row 03's completed packet to name the shared policy; open no new lazy row.

### 2026-07-13 22:45 · inc 03 · review-closure
The same reviewer found one remaining Important case: lowercase `createElement(component)` is dynamic identity, unlike lowercase JSX; RED failed direct/fact/end-to-end paths, GREEN passes all six controls and full v2 338/338, and re-review is clean → close the correctness objection with string-literal native calls still non-widening.

### 2026-07-13 22:45 · inc 03 · verification
The corrected identity policy intentionally changed 16 production oracle observations across `extract-all`, alias/re-export, and duplicate-binding units; eight exact active rows plus checked intent `review-reachability-hardening-20260713` authorized one atomic refresh, then the register returned to empty and parity passed 48/48 in both modes with seam 14/14. A production-only family drift exposed refresh checks being evaluated per mode; a RED/GREEN pair-refresh regression now validates exact registered family transitions across the atomic mode pair without relaxing ordinary parity. Final `verify:full` passes all 16 tasks; production bundles contain neither `animus:drop` nor `__ANIMUS_WITNESS__`, and G4 remains empty.

### 2026-07-13 23:47 · envelope · review-disposition
Lower-severity follow-up retains the supported consumer-plus-package-source graph: exported-but-locally-unrendered components are covered when the consumer renders them, while standalone package-first extraction remains an explicit non-goal (#4). The `(component, prop)` diagnostic key remains deferred under DEF-2 pending value-granularity dogfood (#13), and the private detection-only floor branch remains the intentional G1 test seam unless production multiplicity/API/measurement fires its trigger (#14) → no new increment is licensed.
