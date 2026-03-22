## Context

The manifest from Arc 3 contains the complete enumerated universe: every component, every variant option, every state, every utility class. CSS is generated for ALL of them. A census of the doc site shows 62% of variant/state CSS rules are dead code — defined but never activated at any JSX callsite.

The Finite Style Machine model defines four phases: ENUMERATE (Arcs 1-3, complete), TRANSACT (scan usage), RECONCILE (eliminate unused), SNOWFLAKE (system props, Arc 2). Arc 4 implements TRANSACT + RECONCILE as an optimization pass within the existing project analyzer pipeline.

The JSX scanner (Arc 2) already walks JSX elements and collects system prop values. The extension is to also collect variant prop values, state prop activations, and component-level render tracking. This data feeds the reconciliation phase, which filters ComponentCss before CSS generation.

## Goals / Non-Goals

**Goals:**
- Track variant value usage at all JSX callsites across the project
- Track state prop activation at all JSX callsites
- Track whether each component is rendered at any callsite
- Handle default variants (component rendered without explicit variant = default transacted IN)
- Eliminate CSS rules for unused variant options, states, and entire unused components
- Produce an extraction report summarizing what was kept, eliminated, and bailed

**Non-Goals:**
- Eliminating unused base styles (base styles are always emitted if the component is used)
- Eliminating unused utility classes (utilities are already use-driven from JSX scanning)
- Analyzing dynamic variant values (`variant={someVar}`) — all options transacted IN for safety
- Dev-mode reconciliation — this is production build optimization only
- CSS minification (Lightning CSS) — separate future concern

## Decisions

### 1. Reconciliation as a filter phase, not a generator change

Reconciliation happens BEFORE CSS generation, not inside it. The project analyzer builds the usage ledger, then FILTERS the ComponentCss list to remove unused variant options and state entries. The filtered list is passed to the existing `generate_css_ordered` function unchanged.

This means zero changes to css_generator.rs. The generator doesn't know about reconciliation — it just generates CSS for whatever it receives.

**Alternative considered:** Adding usage-awareness to the CSS generator. Rejected because it couples an optimization concern with a generation concern. The filter approach keeps them separate and testable independently.

### 2. Usage ledger structure

```rust
pub struct UsageLedger {
    /// Which components are rendered at any callsite
    pub rendered_components: HashSet<String>,  // component bindings
    /// Which variant values are used: component_binding → variant_prop → Set<option_values>
    pub variant_usage: HashMap<String, HashMap<String, HashSet<String>>>,
    /// Which state props are activated: component_binding → Set<state_names>
    pub state_usage: HashMap<String, HashSet<String>>,
}
```

The ledger is built from ALL files' JSX scanning results, then cross-referenced with the component manifest to determine what's dead.

### 3. Default variant handling

When a component has `defaultVariant: "fill"` and a callsite renders `<Button />` (no variant prop), the default is implicitly used. The scanner tracks TWO things:

1. Explicit variant values: `<Button variant="stroke" />` → "stroke" used
2. Default activations: `<Button />` (variant prop absent) → default variant "fill" used

The reconciler combines both: used_options = explicit_values ∪ (default if any callsite omits the prop).

If EVERY callsite specifies an explicit variant value, the default MAY be dead — but only if no callsite uses the default value explicitly either.

### 4. Dynamic variant values = transact ALL options

When a variant value is dynamic (`<Button variant={someVar} />`), we can't determine which option is used at build time. Safe behavior: transact ALL options IN for that variant prop on that component. No elimination occurs for that variant.

Similarly, dynamic state props (`active={isActive}`) transact the state IN — we can't prove it's never true.

### 5. Component-level elimination

If a component is defined but never rendered at ANY callsite across the project, its ENTIRE CSS is eliminated: base styles, all variants, all states. The `createComponent` call still exists in the transformed source (the binding must remain valid), but no CSS is emitted.

Edge case: a component might be imported but only used for its `.extend()` method, never rendered directly. In this case, it IS used (as a parent), so its CSS is kept — children inherit from it.

### 6. Extraction report structure

```json
{
  "report": {
    "components": {
      "total": 12,
      "extracted": 10,
      "bailed": 2,
      "eliminated": 1
    },
    "variants": {
      "total_options": 18,
      "used": 8,
      "eliminated": 10
    },
    "states": {
      "total": 27,
      "used": 9,
      "eliminated": 18
    },
    "css": {
      "before_reconciliation_bytes": 4280,
      "after_reconciliation_bytes": 2640,
      "reduction_percent": 38.3
    },
    "eliminated_details": [
      { "component": "GridBox", "reason": "component never rendered" },
      { "component": "Button", "variant": "fill", "reason": "variant option never used" },
      { "component": "FlexBox", "state": "wrap", "reason": "state never activated" }
    ]
  }
}
```

The report is part of the manifest JSON, available to the Vite plugin for logging at build time.

### 7. Reconciliation order in the pipeline

```
Phase 1: Parse all files, collect chains + module info         (existing)
Phase 2: Build binding map via import resolver                 (existing)
Phase 3: Resolve extension provenance                          (existing)
Phase 4: Topological sort                                      (existing)
Phase 5: Evaluate chains + build ComponentCss                  (existing)
Phase 5b: JSX scanning (system props + variant/state usage)    (EXTENDED)
Phase 5c: Build usage ledger from scanning results             (NEW)
Phase 5d: Reconcile — filter ComponentCss by usage ledger      (NEW)
Phase 6: Generate CSS from reconciled ComponentCss             (existing)
Phase 7: Build manifest with usage + report                    (EXTENDED)
```

The new phases slot between existing phases with no structural disruption.

## Risks / Trade-offs

**[Risk] False elimination of variants used via spread props** → If `<Button {...props} />` passes a variant prop through spread, the scanner can't see the explicit value. Mitigation: the scanner already skips spread attributes. If a component ONLY receives its variant via spread (never explicitly), all its variant options survive (none can be proven dead). This is conservative and safe.

**[Risk] Elimination of variants used in tests but not app code** → Test files are excluded from the analysis glob by default (`**/*.test.*`). Variants used only in tests would be eliminated from the production CSS. Mitigation: this is correct behavior — test-only variants shouldn't be in production CSS. Tests should use the Emotion runtime (dev mode) anyway.

**[Trade-off] CSS size measurement is pre-minification** → The report's byte counts are for unminified CSS. Actual production savings depend on downstream minification. The percentage reduction is still meaningful as a relative measure.

**[Trade-off] Report verbosity** → The `eliminated_details` array could be large for design systems with many variants. Mitigation: keep it concise (component + variant/state + reason). Developers can filter or summarize as needed.
