## Context

Animus has a comprehensive RFC.md (1081 lines) covering architecture, builder chains, extraction pipeline, runtime audit, and roadmap. Despite this, three independent agent reviewers in the V1 review produced the same false positives — misattributing token ref opacity, calling by-design patterns "bugs," and missing the graceful degradation model. The RFC is too long and too detailed for evaluators to absorb before reviewing. They need a shorter, claim-oriented document they can check against.

Current state: no dedicated evaluator-facing documentation exists. Reviewers read code, make assumptions, and file findings based on those assumptions.

## Goals / Non-Goals

**Goals:**
- Pre-answer recurring evaluator questions so feedback surfaces real gaps
- Provide verifiable claims (every assertion has a proof pointer)
- Correct the 5 most common false positives from V1 review
- Give prospective adopters a quick mental model without reading the RFC
- Document known limitations honestly with status

**Non-Goals:**
- Replacing RFC.md — the FAQ complements, never duplicates
- Tutorial or getting-started guide — this is not onboarding docs
- API reference — the type system and builder chain are self-documenting
- Updating reviewer personas to reference the FAQ (future follow-up)
- Marketing copy or competitive comparisons

## Decisions

### 1. Single file at `docs/v1-faq.md`

**Rationale:** One file is grep-able, linkable, and impossible to miss. A `docs/` directory signals "documentation" without polluting the repo root. Agents exploring the repo will find it via standard patterns (`docs/`, `FAQ`, `*.md`).

**Alternative considered:** Root-level `FAQ.md` — rejected because the repo root already has `RFC.md` and `README.md`; adding a third top-level doc creates clutter.

### 2. Claim → Truth → Verify triple structure for misconceptions

Each misconception entry follows:
- **Claim**: What evaluators assume (stated neutrally)
- **Truth**: The actual behavior (1-2 sentences)
- **Verify**: `file:function` or `grep` command to confirm

**Rationale:** Evaluators don't trust documentation claims — they trust evidence. The verify step turns each FAQ entry into a testable assertion. Using `file:function` rather than `file:line` because line numbers shift; function names are stable.

**Alternative considered:** Prose-style explanations — rejected because evaluators scan, they don't read essays.

### 3. Feature matrix as binary table with "how" column

| Feature | Supported | How |
|---------|-----------|-----|

**Rationale:** "Does it do X?" is the most common evaluator question. A scannable table with yes/no answers and a brief "how" prevents both false negatives ("it can't do that") and false positives ("it does that via...").

### 4. Known limitations with status tags

Each limitation gets a status: `planned`, `designing`, `not-planned`, or `known-constraint`.

**Rationale:** Honesty about gaps builds trust. Status tags tell evaluators whether to file a finding or not — `planned` means "we know, it's coming," `known-constraint` means "this is a deliberate trade-off."

### 5. No prose duplication from RFC.md — reference by section

Where the FAQ needs to explain something covered in the RFC, it links: "See RFC.md §7: Extraction Pipeline" rather than restating.

**Rationale:** Single source of truth. Two documents saying the same thing will inevitably diverge.

### 6. Prop groups positioned as user-defined, not framework-provided

The FAQ must explicitly state that prop groups (space, color, typography, etc.) are 100% consumer-defined via `.addGroup()`. The showcase's groups are that app's design choices. Animus provides the primitive, not the opinions.

**Rationale:** This is the #1 positioning confusion. Every reviewer assumed the showcase's groups ARE the framework. The FAQ corrects this upfront.

## Risks / Trade-offs

- **[Staleness]** → FAQ content can drift from codebase reality. Mitigation: every claim has a verify step; stale claims are detectable by running the verify command.
- **[Incomplete coverage]** → FAQ can't anticipate every misconception. Mitigation: structured format makes adding entries trivial; treat it as a living document.
- **[Over-documenting]** → Risk of the FAQ growing into a second RFC. Mitigation: strict constraint — no entry without a concrete false-positive trigger or adoption question. If it's not answering a real question, it doesn't belong.
