# Increment Registry — restore-spec-tree-integrity

## 1. Increments

- [x] 01 [mode:inline · review:self] increments/01-canonicalizer-inventory.md — resolves: edge-case-handling · authors: — · deps: — · footprint: openspec/changes/restore-spec-tree-integrity/tools/**
- [x] 02 [mode:inline · review:subagent] increments/02-apply-canonicalization.md — resolves: — (produces the failure report that is the resolving signal for the invalid-residue and gate rows) · authors: §arch-spec-corpus/Canonical section structure · deps: 01 · footprint: openspec/specs/**
- [x] 03 [mode:inline · review:self] increments/03-prop-strict-mode-backfill.md — resolves: — · authors: §prop-strict-mode/* (four requirements from the archived delta) · deps: 01 · footprint: openspec/changes/restore-spec-tree-integrity/specs/prop-strict-mode/**, openspec/changes/archive/prop-strict-mode/** (rename only)
- [ ] 04 [mode:inline · review:self] (lazy — signal: `openspec validate --all` passes clean after inc 02/03 — signal checked at inc 03 reorientation: NOT fired; row CARRIED FORWARD to the content-triage follow-up change, which owns eliminating the 3 residue specs and can then fire the signal; does not block archive) — resolves: validate-gate-placement · authors: §arch-spec-corpus/Validation gate · deps: 02, 03 · footprint: vite.config.ts, CLAUDE.md

## 2. Cross-cutting

- [x] 2.1 Triage inventory (per-spec classification + residual-failure report) is preserved in the change dir for the follow-up content-triage change — inventory.json (overwrite-guarded post-review: dry-runs write inventory.dry.json) + residual-failures.txt (3 invalid specs annotated, hand-removal record, 76-file boilerplate-Purpose worklist pointer, authored-content disclosure)
