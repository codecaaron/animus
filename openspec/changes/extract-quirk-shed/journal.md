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
