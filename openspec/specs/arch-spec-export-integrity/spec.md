# arch-spec-export-integrity Specification

## Purpose

Main specs name only symbols that resolve today; aspirational surface lives only in open-change deltas.

## Requirements
### Requirement: Main specs carry no aspirational exports

A main spec in `openspec/specs/` SHALL name only symbols that resolve today: every symbol listed in a requirement's export scenario resolves in the barrel that requirement names. Delta specs inside an open change MAY be aspirational — the open change is the license; a main-spec requirement with no open change behind it is indistinguishable from drift. Known blind spots: the executable check matches the barrel's text, so a symbol appearing only in a comment would pass; it verifies the pipeline subpath barrel, not re-export from the package root.

#### Scenario: Export-list symbols resolve in the pipeline barrel

- **WHEN** the following command is run (self-parsing and vacuity-guarded: it fails loud with `GUARDRAIL VACUOUS` if the scenario it reads was renamed or reformatted, instead of passing empty)

```bash
SYMS=$(grep -A4 'Scenario: Utilities importable from pipeline subpath' openspec/specs/extract-pipeline/spec.md | grep 'SHALL have access to' | grep -o '`[A-Za-z]*`' | tr -d '`'); [ -n "$SYMS" ] || { echo "GUARDRAIL VACUOUS: parsed zero symbols"; exit 1; }; echo "$SYMS" | while read -r s; do grep -q "\b$s\b" packages/extract/pipeline/index.ts || echo "MISSING: $s"; done
```

- **THEN** it prints nothing: every parsed symbol resolves in `packages/extract/pipeline/index.ts`, and any `MISSING:` line is a violation

