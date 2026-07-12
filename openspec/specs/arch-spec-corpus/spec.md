# arch-spec-corpus Specification

## Purpose
Architectural constraints on the OpenSpec main tree itself: every capability spec under `openspec/specs/` stays canonical and machine-valid, so the tree remains a trustworthy sync target for archived change deltas. Each requirement is backed by an executable check runnable from the repository root.
## Requirements
### Requirement: Delta-header freedom in the main tree

Files under `openspec/specs/` SHALL NOT contain delta-format section headers (`## ADDED Requirements`, `## MODIFIED Requirements`, `## REMOVED Requirements`, `## RENAMED Requirements`). Delta sections belong to change directories under `openspec/changes/`; the main tree holds only current-state canonical specs.

#### Scenario: Grep for delta headers over the main tree returns empty

- **WHEN** `rg -n '^## (ADDED|MODIFIED|REMOVED|RENAMED) Requirements' openspec/specs/` is run from the repository root
- **THEN** the command SHALL produce zero matches

### Requirement: Canonical section structure

Every file under `openspec/specs/` that contains requirement blocks (`### Requirement:` headers) SHALL also contain a `## Purpose` section and a `## Requirements` section.

#### Scenario: Requirement-bearing files without a Purpose header

- **WHEN** `rg -l '^### Requirement:' openspec/specs/ | xargs grep -L '^## Purpose'` is run from the repository root
- **THEN** the command SHALL produce zero lines of output

#### Scenario: Requirement-bearing files without a Requirements header

- **WHEN** `rg -l '^### Requirement:' openspec/specs/ | xargs grep -L '^## Requirements'` is run from the repository root
- **THEN** the command SHALL produce zero lines of output

