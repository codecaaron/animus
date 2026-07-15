# Journal: <change-name>

<!--
Append-only temporal log, seeded at first apply run, written throughout.
Deliberately cheap: 1-3 lines per entry, written at the moment of
observation, never restructured. Newest entries at the BOTTOM (append means
append). Wall-clock may be non-monotonic across sessions — POSITION in the
file, not timestamp, is the authoritative order; never insert or reorder.

Entry grammar:
  ### <YYYY-MM-DD HH:mm> · <inc NN | envelope> · <type>
  <observation> → <implication or action pointer>

Types (closed set):
  seed            the journal's FIRST entry, written when apply seeds this
                  file: records which registry rows were ENVELOPE-LICENSED
                  (created at propose time, before the journal existed)
  surprise        an assumption proved wrong
  friction        tooling/process pain worth remembering
  signal          a Ledger resolving signal APPEARED — cite the row ID
                  (DEF-<n>). This entry is what licenses creating a lazy
                  increment; no signal entry, no creation.
  guardrail-trip  a Register check failed — cite G<n> + output excerpt
  reorientation   structured OODA record (grammar below)
  objection       an adversarial stance's or external review's finding +
                  disposition (verify §14 aggregates review findings as
                  RF-<n> rows)
  mode-change     a registry row's mode/review changed + the trigger
  spawn           a new increment row added mid-flight + why

Reorientation entry grammar (written at every increment landing, before the
registry tick):
  ### <timestamp> · inc <NN> · reorientation
  - Observe: <entries since last checkpoint; gate results; [~] deferrals>
  - Orient: <outcome vs Ledger predictions · state vs NS<n> by number · lazy
    rows vs Review-by (reorientation count AND calendar date)> — stances run:
    <full pass (falsifier · entropy auditor · heretic) | entropy auditor
    only>, objections: <count, see objection entries — full passes record
    >= 1 objection or an evidence-backed zero PER STANCE>
  - Decide: <explicit disposition per open thread — continue / re-plan NN /
    spawn / retire NN / revise NS<n> / mode-change NN. "Continue" is valid
    but must be WRITTEN.>
  - Act: <Ledger flips, registry edits, north-star revisions applied>

SINGLE-WRITER RULE: only the orchestrating agent appends. Delegated subagents
PROPOSE entries in their output contract; the orchestrator reviews and appends
them attributed `via inc <NN> subagent`.

Downstream consumers (do not duplicate their content here): reorientation's
Observe phase; retrospective §0 (deferral-outcome join, entry counts) and §5
(surprise triage); verify §12 (coherence reconciliation).
-->

### <YYYY-MM-DD HH:mm> · envelope · seed

<example> Journal opens at apply start. Envelope-licensed rows: 01, 02 (decided-now / self-resolving at propose) → all later creations require a signal entry.

### <YYYY-MM-DD HH:mm> · envelope · signal

<example> DEF-2's benchmark harness landed with increment 01 → lazy row 02 is now creatable.
