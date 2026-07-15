# Migrating existing changes across schema versions

Migration is INTERPRETIVE, not retroactive: never rewrite archived changes; apply the
rules below to in-flight changes the next time each artifact is touched.

## v3 → v4/v5: interpreting old artifacts

- **Decided-now Ledger rows** (`decided-now | — | — | —`): read as §Decisions
  entries. On next touch of design.md, move each to a `### D<n>` entry and
  delete the row — the Ledger is deferred-rows-only now.
- **Prose-keyed deferrals**: assign `DEF-<n>` IDs on next touch; update any
  registry `resolves:` / lazy-row references from prose to the token.
- **Lazy rows with verbatim signal prose** (`(lazy — signal: <prose>)`):
  read as blocked on the Ledger row whose Resolving signal matches that
  prose; rewrite to `(lazy — blocked on: DEF-<n>)` on next touch.
- **`resolves: D<n>` referencing deferred work**: read as the DEF row that
  later promoted to that decision; correct opportunistically.
- **Cross-cutting rollout rows** (deploy sequencing, IAM scope, one-time
  jobs): tag `gate:ops` on next touch and open OPS-<n> rows in
  ops-runbook.md (template ships with the schema).
- **Guardrail Register commands in table cells**: commands with escaped
  pipes (`\|`) are corrupted for copy-paste — move them to fenced blocks
  keyed by G-ID below the table on next touch.
- **Single-report verify.md**: still valid; the next verifier APPENDS a new
  `## Report:` section rather than overwriting.
- **Review-by as a bare count**: read as `<n> reorientations | (no date)`;
  add a calendar date for external-dependency rows on next touch.
- **No journal `seed` entry**: pre-v5 changes created increments at propose
  time under "safe to fix now" — grandfathered. If apply is still running,
  append a late `seed` entry naming the envelope-licensed rows.

## v4 → v5 deltas (2026-07-07 hardening round)

- verify reports gained: severity split (WARN vs EVIDENCE-GAP), verdict axes
  (Artifact / Implementation / Rollout + archive decision), §13 packaging &
  change boundary (untracked reachability, foreign-diff dispositions,
  ambient-branch-drift naming, dirty-tree patch fingerprint), §14
  review-finding intake (RF-<n> rows), targeted-validation-as-hard-gate.
- `review:subagent-if-available` is a valid third reviewer mode (inline
  exploratory rows; no mode-change ceremony).
- Retired lazy rows are explicit completion:
  `- [x] … (retired — journal <ts>)`.
- `external:` tokens are kebab-slugs, not prose.
- `scripts/registry-lint.mjs` ships with the schema; verify §2 runs it —
  v4-era registries may emit warnings (e.g. missing `ticked:` annotations);
  treat those as migration debt, not failures, until the change is next
  touched.
- Archive gained the cross-change collision block (5d) and the archive
  decision step (5e).

Old v4 artifacts need no rewriting: v5 is additive on the artifact grammar;
the lint downgrades unknown-but-plausible v4 shapes to warnings.
