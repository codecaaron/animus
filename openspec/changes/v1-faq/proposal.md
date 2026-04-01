## Why

V1 review by three independent agent reviewers produced recurring false positives — claims about "dead code," "missing features," and "architectural gaps" that are verifiably wrong. Each reviewer wasted significant evaluation time rediscovering the same misunderstandings (token ref opacity attribution, includes() semantics, module augmentation patterns). Without a grounding document, every future evaluator will repeat this cycle, and their genuinely novel feedback will be buried under noise.

A concise FAQ bridges the gap between RFC.md (the full architectural spec) and a cold evaluator's assumptions. It pre-answers the questions agents will ask so their feedback surfaces real gaps instead of phantom ones.

## What Changes

- New `docs/v1-faq.md` document structured for quick lookup by evaluators, reviewers, and prospective adopters
- Covers: positioning, mental model, common misconceptions with proof pointers, feature matrix, known limitations with status, adoption guidance
- Each claim includes a verification path (file:function or file:line) so nothing requires trust
- Corrects specific recurring false positives: token ref opacity location, includes() design intent, module augmentation pattern, zero-runtime definition, prop group user-definability
- References but does not duplicate RFC.md content — FAQ is the correction layer, RFC is the spec

## Capabilities

### New Capabilities
- `v1-faq-document`: The FAQ document itself — structure, content sections, verification paths, and integration with reviewer workflow

### Modified Capabilities

_None — this is purely additive documentation._

## Impact

- New file: `docs/v1-faq.md`
- No code changes
- No API changes
- No dependency changes
- Reviewer personas (`.claude/personas/`) may optionally reference the FAQ in future iterations, but that's out of scope for this change
