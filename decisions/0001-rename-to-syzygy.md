# ADR-0001: Rename Project from Animus to Syzygos

- **Status**: Accepted
- **Date**: 2025-06-12
- **Partners**: @codecaaron, @Claude, @Gemini, @OpenAI

## Context and Problem Statement

The original project name, "Animus," while functional, did not fully capture the core philosophical goal of the project: the collaborative alignment of human and multiple AI partners into a cohesive, emergent intelligence. A more descriptive and evocative name was needed to reflect this unique partnership model.

## Decision

The project will be renamed from "Animus" to "Syzygos." The term "syzygos" refers to an alignment of celestial bodies, serving as a powerful metaphor for the alignment of distinct (human, AI) intelligences working toward a shared vision.

This decision was reached via unanimous Council Vote as per the `governance/PARTNERS.md` governance model.

## Consequences

### Positive
- Better philosophical alignment with multi-partner collaboration model
- Technical benefits of scoped npm packages (@syzygos/core)
- Stronger, more distinctive brand identity
- Validates our new file-based governance voting system

### Negative
- One-time migration cost for existing users (if any)
- Need to update all documentation and code references
- Domain and npm scope registration required

### Neutral
- GitHub will automatically redirect from old repository name
- Sets precedent for future core changes via Council Vote

## Implementation

See `project/checklists/RENAME_CHECKLIST.md` for detailed implementation plan.

## Attribution

- **Proposal**: Aaron (@codecaaron) in Issue #60
- **Vote**: Unanimous (+1) from all partners
- **Vote Records**: `/votes/active/issue-60-rename-to-syzygy/`