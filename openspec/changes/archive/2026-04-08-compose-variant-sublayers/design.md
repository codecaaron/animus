## Context

Compose variant CSS currently uses specificity engineering within a flat `@layer variants` to order three rule categories: sidecar defaults (0,1,0), inheritance (0,2,0), and overrides (0,3,0). This approach broke twice in one session — CSS minifiers can reorder selectors at equal specificity, and the three-tier system creates source-order dependencies that are invisible until they fail.

The current compose CSS emission lives in `css_generator.rs`:
- `generate_composed_variant_css()` (line ~518) iterates families/children/shared-keys
- `write_composed_rule_pair()` (line ~566) emits inheritance + override selectors
- Compose rules are string-surgery-appended into `@layer variants` in `project_analyzer.rs` (line ~1232)

The sidecar `--{prop}-default` class was added to `VariantCss.default_option` and emitted in the Variants arm of `generate_layer_content()`. Runtime branching in `resolveClasses.ts` distinguishes defaultVariant fallback from explicit props.

## Goals / Non-Goals

**Goals:**
- Replace specificity-based ordering between standalone and compose rules with structural layer ordering
- Make the cascade contract minifier-proof (layer boundaries cannot be reordered)
- Apply the same sublayer topology to `@layer compounds` for composed compound correctness
- Retain the sidecar default class with a simplified role (layer ordering replaces specificity arithmetic)
- Preserve `.variant().variant()` chain definition order for non-shared variants

**Non-Goals:**
- Transitive compose propagation (CSS-only compose is inherently single-hop — this is a known limitation of the CSS-only model, not a sublayer concern)
- Composed compound + child override semantic mismatch (parent's class anchors the compound selector even when child overrides; fixing requires combinatorial `:not()` exclusions — out of scope, documented as known limitation)
- Changes to the top-level layer declaration order (`global, base, variants, compounds, states, system, custom`)
- Three sublayers for inheritance/override separation (the 0,2,0 vs 0,3,0 gap within `composed` is a structural invariant of the selector shapes — no layer separation needed)

## Decisions

### Decision 1: Two sublayers — `standalone` and `composed`

**Choice:** `@layer standalone, composed;` within both `@layer variants` and `@layer compounds`.

**Why not three sublayers (standalone/inheritance/override)?** The inheritance selector `.Root--var-opt .Child` is structurally (0,2,0) and the override selector `.Root .Child.Child--var-opt` is structurally (0,3,0). This gap is inherent to the selector shapes — it can't be eroded by combinatorics or disrupted by minifiers (different specificities are never reordered). Adding a third sublayer would increase structural complexity without solving a real problem.

**Why not "atomic" naming?** "Atomic" has existing connotations in the CSS world (Atomic CSS / utility-first). "Standalone" is self-descriptive — rules that apply to a component standing alone, outside any compose family.

### Decision 2: Sidecar retained in `standalone` sublayer

**Choice:** The `--{prop}-default` sidecar class is retained. It lives in `@layer standalone`.

**Why not eliminate it?** The sidecar encodes a semantic distinction the cascade cannot infer: "this value comes from defaultVariant fallback" vs "this value was explicitly set." Without it, the override rule for the default option matches when the child gets the default variant class, causing the child's default to beat the parent's inheritance — the exact bug that motivated the sidecar. With sublayers, the sidecar's job is simpler: it just needs to exist in `standalone` so compose rules in `composed` beat it by layer ordering. No specificity tier engineering needed.

### Decision 3: Composed compound inference from selectors

**Choice:** For compound conditions that reference shared variant props, substitute the parent's inheritance selector pattern for the child's own variant class in the compound rule.

**Example:** Compound `{ size: 'sm', intent: 'primary' }` on a child where `size` is shared becomes `.Root--size-sm .Child.Child--intent-primary` instead of `.Child--size-sm.Child--intent-primary`. The shared dimension uses the parent's state; non-shared dimensions use the child's own classes.

**Why this works:** The extractor already knows which props are shared (from `ComposeFamilyInfo.shared_keys`). It can partition compound conditions into shared-prop dimensions (use inheritance selector) and local-prop dimensions (use child class).

### Decision 4: Auto-provisioning — sublayers only when compose families exist

**Choice:** The sublayer declaration and structure are emitted only when the project has at least one compose family. Projects without compose families get flat layers (no behavioral change).

**Why:** Sublayers add no value without compose. Auto-provisioning keeps non-compose projects clean and avoids devtools noise. The extractor already tracks compose families via `ComposeFamilyInfo` — the provisioning decision is a simple presence check.

**Migration note:** Un-layered rules within a layer have higher priority than sublayered rules (CSS spec). If a project transitions from no-compose to compose, previously un-layered variant rules move into `standalone`, which is a lower-priority position. This is correct — standalone rules SHOULD lose to compose rules. No migration action needed.

### Decision 5: Structured sublayer emission replaces string surgery

**Choice:** Replace the current string-surgery approach in `project_analyzer.rs` (truncate closing brace, append, re-close) with structured sublayer block emission.

**Why:** String surgery is fragile and hard to reason about. With sublayers, the emitter produces two distinct content blocks (`standalone` content and `composed` content) and wraps them in their respective `@layer` blocks. The Variants arm of `generate_layer_content()` produces standalone content; `generate_composed_variant_css()` produces composed content. Assembly happens in `project_analyzer.rs` by combining the two blocks inside `@layer variants { @layer standalone, composed; @layer standalone { ... } @layer composed { ... } }`.

## Risks / Trade-offs

**[Layer nesting depth]** Adding sublayers increases the CSS layer tree from depth 1 to depth 2 at the `variants` and `compounds` branches. No browser has documented performance concerns at this depth. Measurable degradation only occurs at 20+ nested layers. **Mitigation:** Two sublayers per parent layer is the maximum this design introduces.

**[Composed compound selector complexity]** Multi-shared-prop compound conditions produce long selectors (`.Root--size-sm.Root--intent-primary .Child.Child--density-comfortable`). **Mitigation:** This is no worse than standalone compound selectors with multiple conditions. Specificity increases naturally with more conditions, which is correct (more-constrained compounds should beat less-constrained ones).

**[Composed compound + child override mismatch]** When a child overrides a shared prop, composed compounds conditioned on that prop still fire based on the parent's state. CSS and runtime disagree. **Mitigation:** Documented as known limitation of CSS-only compose. Fix requires combinatorial `:not()` exclusions — deferred unless demand materializes.

**[Transitive compose single-hop]** CSS inheritance applies styles, not classes. A component that inherits a variant from a parent cannot propagate it to its own compose children via CSS. **Mitigation:** Pre-existing limitation. `context: true` mode handles transitive propagation correctly. Sublayers don't change this.
