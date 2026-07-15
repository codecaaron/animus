# Journal: prop-flow-reachability

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
Journal opens at apply start. Envelope-licensed rows: 01 and 02 (decided-now / self-resolving at propose time); rows 03–08 require their declared external/input or Ledger signals before packet creation.

### 2026-07-13 20:55 · inc 03 · signal
`change:extract-v2-default-flip#02` is ticked at 2026-07-13 03:20 and both plugin defaults resolve to v2 (`options.engine ?? 'v2'`) → `external:extract-v2-engine-flip` is fulfilled; row 03 still awaits dependency row 01's tick before packet creation.

### 2026-07-13 21:06 · inc 01 · reorientation
- Observe: additive `usageResidue` landed; Rust 308/308, canary 199/199, integration 138/138, parity 48/48 in both modes plus seam 14/14 and zero baseline divergence, G4, tool 4/4, and three consumer captures pass. Histogram: one site — identifier / `logoSize` / `Logo`; receipt records one manifest and exit 0 per consumer. Full review found four Important and one Minor objections; unary/parenthesis classification, disabled-hook mutation, exact two-file boundary coverage, and receipt provenance were fixed, then the same reviewer returned `SPEC RE-REVIEW CLEAN`.
- Orient: NS2 remains supported and NS3 now gives every dynamic site a closed reason; NS4 forbids lazy machinery because DEF-1/2/3 predicates are not measured. DEF-5's extra-form trigger is falsified — stances run: full pass, objections: 4 Important + 1 Minor, all implementation objections closed on re-review.
- Decide: keep DEF-1/2/3 deferred and revise their signals to require direct wrapper-depth, typed-resolvability, and annotation-resolvability probes; resolve DEF-5 to retain narrow arm-join breadth and retire row 08 without a packet.
- Act: mark G2 passed, revise G4 to HEAD, tick row 01 and retire row 08; row 03 is now licensed by its recorded flip signal plus dependency completion, while rows 04–06 remain carried forward.

### 2026-07-13 21:11 · inc 02 · reorientation
- Observe: all five outcomes record at `globalThis.__ANIMUS_WITNESS__`; cap 5000 and oldest-first eviction are verified; focused 4/4, compile, types, unit:ts 213/213, G3 production exclusion, and G4 pass. Spec review was clean; quality review found one formatter issue, fixed and approved on clean re-review.
- Orient: D4's dev-only, bounded, transport-free recorder is satisfied. Entropy audit records one Minor objection: front-splice is O(cap) after saturation, but there is no dogfood evidence of saturation or latency harm — stances run: entropy auditor only, objections: 1 Minor.
- Decide: retain the initial array buffer; keep DEF-4 and row 07 deferred pending stable witness sets plus saturation/latency observations across showcase dev runs.
- Act: mark G3 passed and tick row 02; add no transport, persistence, or circular-storage machinery.

### 2026-07-13 21:25 · inc 03 · packet
The recorded v2-default signal and completed residue dependency now license statics enrichment; the existing Pass-B `FileFacts.statics` map already includes local/imported/re-exported values → author a fact-layer packet that enriches usage during the same AST pass, with no reparse or runtime changes.

### 2026-07-13 21:51 · inc 03 · reorientation
- Observe: RED/GREEN coverage resolves local, imported, and re-exported identifiers, members, and responsive objects; ternary and partial-known `??`/`||` values reach final CSS/map output while their residue remains. Scope-shadow and captured-transform regressions failed before their conservative fixes. Focused enrichment passes 10/10, full v2 326/326, Rust/canary/integration and all consumer gates pass, G1/G4/diff-check pass, and the single registered oracle refresh finishes with parity 48/48 in both modes plus seam 14/14. Final consumer residue remains one `Logo.logoSize` identifier (1 before, 1 after, 0 moved). Review raised three Important and one Minor findings; lexical identity, capture strictness, normative logical wording, and end-product coverage were fixed, then spec and quality re-reviews approved.
- Orient: D3/D5 land as additive map fattening with exact lexical binding identity and conservative retention at every uncertain join; NS1/NS2 hold, while the unchanged one-site histogram supplies no wrapper-depth, typed-resolvability, annotation-resolvability, or witness-stability signal — stances run: full pass, objections: 3 Important + 1 Minor, all closed.
- Decide: complete depth-0 enrichment; carry DEF-1/2/3 and rows 04–06 until their direct probes exist, carry DEF-4/row 07 until showcase-dev witness stability and saturation are measured, and retain the already-resolved narrow arm breadth (DEF-5/row 08).
- Act: mark G1 passed, strengthen D5 with symbol-identity/capture rules, tick row 03, publish the capture receipt, and leave all unsignaled lazy rows unticked.

### 2026-07-13 22:31 · inc 03 · review-correction
External review showed `extract_file_facts_enriched` had promoted the serialized raw usage contract and repeated Pass-A static traversals in Pass B → separate raw public facts from a serde-skipped analysis view and pass the already-computed local/complete maps into extraction.

### 2026-07-13 22:31 · inc 03 · reorientation
- Observe: RED proved identifier `staticValue` and conditional `enumerableValues` leaked into raw Rust/NAPI facts; GREEN keeps both raw while preserving engine enrichment. Pass B now reuses Pass-A maps; full v2 passes 334/334. [~] DEF-1/2/3/4 still lack their declared measurement signals.
- Orient: D3's map fattening remains valid only as an internal analysis view; restoring raw serialization preserves the public contract without changing enriched CSS outcomes or opening a new machinery tier — stances run: entropy auditor only, objections: 2 (#5 contract, #8 duplicate pass), both corrected pending final re-review.
- Decide: retain enrichment internally, keep public `FileFacts.usage` syntax-classified, and reuse Pass-A statics; carry every lazy row unchanged.
- Act: strengthen D3 and the scanner delta, amend row 03's completed packet to record raw/enriched separation, and add no Ledger row.

### 2026-07-13 22:45 · inc 03 · review-closure
Bounded compliance review confirms raw/NAPI usage remains syntax-classified, Pass B reuses Pass-A maps, and known aliases share canonical usage identity. Its sole Important objection—lowercase dynamic `createElement` identity—failed direct/fact/end-to-end REDs, passes six focused controls plus full v2 338/338 after correction, and the same reviewer returned CLEAN.

### 2026-07-13 22:45 · inc 03 · verification
The checked production-only oracle transition refreshed atomically after pair-wide exact family validation; clean parity is 48/48 in production and development with seam 14/14, the live register is empty, and final `verify:full` passes all 16 tasks including 216 TS tests, 338 v2 Rust tests, integration 138/138, and all three consumer build/assert paths. Deferred rows 04–07 remain unsignaled and unchanged.

### 2026-07-13 23:47 · inc 02 · review-hardening
Reviewer #9 reproduced production witness-argument work as two observable variant-value serializations where class construction requires one; RED expected one and received two. `recordWitness` now accepts the raw value and serializes only after its production gate; GREEN passes focused 6/6, compile, types, and unit:ts 217/217. The fail-loud dynamic `AttrFact` kind/span assertions remain intentional until another constructor/deserializer or a schema-versioned raw-facts redesign exists (#15) → no deferred machinery row is licensed.

### 2026-07-15 14:44 EDT · envelope · reorientation
- Observe: delivered rows 01–03 and retired row 08 are complete; DEF-1/2/3 still lack direct wrapper-depth, typed-resolvability, and annotation-resolvability probes, and DEF-4 still lacks showcase-dev stability/saturation evidence. The final bounded audit raised no evidence that any trigger fired.
- Orient: NS4 forbids manufacturing compiler machinery without those measurements, while leaving unsignaled rows as active checkboxes obscures the completed delivery boundary — stances run: full pass, objections: 0 to retiring the rows while preserving their exact signals, owners, and review dates.
- Decide: close this envelope at its implemented scope and carry DEF-1–4 as durable, externally owned follow-ups rather than incomplete implementation work.
- Act: add `followups.md`, transfer Ledger ownership to explicit external signal owners, and retire rows 04–07 without claiming their deferred decisions resolved.
