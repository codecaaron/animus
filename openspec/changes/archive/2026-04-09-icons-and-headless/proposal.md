## Why

The doc primitives (sessions 54-55) use ~6 inline SVG icons across CopyButton, Heading, ChainStep, and SyntaxBlock. These work but don't scale — adding new doc components means hand-drawing SVGs each time. Separately, interactive patterns like MethodCard's accordion and TabGroup's tabs would benefit from headless UI primitives (ark-ui) for reduced a11y maintenance — panel association, focus trapping, and ARIA state management that we currently hand-roll.

Animus's interop seams — data-*/aria-* attribute passthrough, selector aliases targeting both ARIA and data-attribute conventions, polymorphic rendering via asChild/asComponent — were intentionally designed for headless library composition. Session 55's polish pass validated the component-level patterns (.states(), compose(), selector aliases). This change validates the external integration boundary.

### Competitive Grounding

Animus shares the same **integration seam** as Panda+Ark (build-time extraction + headless data-attributes + polymorphic rendering) but uses a fundamentally different **extraction model**. The distinction matters:

- **Panda CSS**: token-in, atomic-class-out. CSS is flat utilities. No cascade contract.
- **Animus**: builder-chain-in, layered-component-CSS-out. CSS preserves cascade structure (`@layer base, variants, compounds, states`). Human-readable, debuggable, deterministic specificity.

This layered extraction is Animus's moat for headless composition: attribute selectors and state styles land in specific cascade layers with predictable override behavior, rather than competing in a flat atomic specificity space.

```
                    EXTRACTION          HEADLESS     CSS OUTPUT         COMPOSITION
Animus + Ark        Rust AST/build      ark-ui       layered/semantic   asChild / asComponent / as
Panda + Ark         codegen/build       ark-ui       atomic/flat        asChild
Vanilla Extract     codegen/build       any          scoped/flat        className merge
shadcn + Radix      Tailwind            Radix        atomic/flat        asChild + cn()
StyleX (Meta)       compiler/build      any          atomic/determ.     className merge
CSS Modules + any   scoped/build        any          scoped/flat        className merge
```

Notable: Radix has a known data-state collision issue (GitHub #2096) when multiple primitives target the same element. Animus avoids this entirely — `.states()` produces CSS classes (`ComponentName--stateName`), not data-state attributes. Orthogonal mechanisms, no collision possible.

**Why Animus over alternatives for headless integration:**
- **vs Panda+Ark**: Cascade contract — state selectors land in `@layer states`, variants in `@layer variants`. Predictable overrides without specificity wars. `.extend()` for customization without forking source.
- **vs shadcn+Radix**: Abstraction over ownership. shadcn's copy-paste model gives full control but no extraction guarantees. Animus trades source ownership for cascade predictability and type-safe builder chains. The tradeoff is explicit: you get guarantees, you give up forking.
- **vs Vanilla Extract**: Similar scoped extraction, but Animus's builder chain produces layered CSS with variant/state/compound separation. VE recipes are flat.

## What Changes

### Track A — Icon System (lucide-react)

**Decision: lucide-react.** Pragmatic, tree-shakeable, 1400+ icons, zero design work. Not building a createIcon factory — that's infrastructure for a need that doesn't exist (showcase needs ~15 icons, not an icon system).

- Add `lucide-react` to showcase dependencies
- Replace inline SVGs in CopyButton (copy/check), Heading (link/check), SyntaxBlock (chevron), ChainStep (arrow connectors)
- Convention: import individual icons within the component file that uses them. The component's public API stays the same (e.g., `<CopyButton>` not `<CopyButton icon={Check}>`). lucide is an implementation detail, not a public dependency.
- Icons use `currentColor` + size props; Animus parent controls color via tokens.

~15 icons total across existing components.

### Track B — Headless Composition (ark-ui)

**Recommended default: `asChild` for composition, selector aliases for styling headless state.** Other paths are valid escape hatches documented below.

#### Composition (how styles meet behavior)

- **asChild** (recommended): Animus component delegates rendering to headless child. Extracted classes merge onto the child element. Cleanest prop boundary — no prop conflicts between Animus variant props and headless component props.
- **asComponent**: Animus wraps the headless component directly. Tighter coupling, single component tree. Use when prop shapes are known-compatible.
- **as** prop: Runtime polymorphism. Simplest but least type-safe. Use for one-off overrides.

#### Styling headless state (how Animus reacts to ark-ui's data-state)

1. **Selector aliases** (recommended default) — `_expanded`, `_checked`, `_disabled` etc. already match both `[aria-expanded="true"]` AND `[data-expanded]` conventions. Works today, type-safe, pre-defined set covers common headless states.

2. **Manual selectors** — `'&[data-state="open"]': { opacity: 1 }` in `.styles()`. Works today. Verbose but explicit, targets any attribute. Use when no alias exists.

3. **data-state as variant key** — `.variant({ prop: 'data-state', variants: { open: {...}, closed: {...} } })`. This works via class reactivity, not attribute selectors: extraction emits `.Component--data-state-open { ... }` (class), and the runtime resolves the variant prop to the correct class each render. The prop also passes through to the DOM as `data-state="open"` (data-* passthrough). The class handles styling; the attribute handles interop. Both update each React render cycle. Specificity sits in `@layer variants`, independent of the DOM attribute. **More integrated but less obvious — document as advanced pattern after spike validates.**

#### Spike scope

1. Add `@ark-ui/react` to showcase dependencies
2. Test with ONE component: TabGroup → Ark Tabs
   - Verify className merging works via asChild
   - Verify extraction produces correct CSS with headless child
   - Test selector aliases + data-state variant key strategies
   - Confirm ark-ui tree-shakes properly (`@ark-ui/react/tabs`)
   - Document migration: TabGroup's `activeTab`/`onChange` → Ark Tabs' `value`/`onValueChange`. Consumer API should remain stable — changes absorbed in the wrapper.
3. If spike passes: migrate TabGroup fully, then MethodCard → Ark Accordion
4. If spike reveals issues: document where the boundary is, keep hand-rolled implementations

#### What we gain (and don't)

The hand-rolled TabGroup already has keyboard nav (ArrowLeft/Right, Home/End, wrap-around) and roving tabindex. What ark-ui adds:
- **Panel association** (aria-controls/aria-labelledby linking between tab and panel) — currently missing
- **Focus management** beyond our hand-rolled version (focus trapping, restoration)
- **Maintenance reduction** — stop maintaining a11y code, delegate to a library that tracks WAI-ARIA spec changes
- For MethodCard → Accordion: proper multi-expand control, animated height transitions

**Components that benefit from headless migration:**
- TabGroup → Ark Tabs
- MethodCard → Ark Accordion
- Future: Dialog, Popover, Menu, Tooltip (as needed, not pre-emptively)

## Capabilities

### New Capabilities
- `icon-convention`: lucide-react import pattern for showcase icons
- `headless-composition`: documented strategies for composing Animus ds elements with ark-ui primitives (recommended defaults + escape hatches)

### Modified Capabilities
- `doc-atoms`: CopyButton icons → lucide
- `doc-interactive`: TabGroup potential ark-ui migration, ChainStep icons → lucide
- `doc-reference`: MethodCard potential ark-ui Accordion migration
- `markdown-renderer`: Heading icons → lucide, SyntaxBlock icons → lucide

## Impact

- **New dependencies**: `lucide-react` (Track A), `@ark-ui/react` (Track B)
- **Risk**: LOW for Track A (drop-in icon replacement). LOW for Track B — integration seam is proven (Panda+Ark ships this in production), extraction is unaffected (sees builder chains, not runtime composition), data-state collision is impossible (orthogonal mechanisms).
- **Consumer API**: No breaking changes. TabGroup/MethodCard maintain their current props interfaces. Ark-ui state management is absorbed in the convenience wrapper.
- **Extraction**: Polymorphic rendering (asChild/asComponent) keeps ds elements as normal extraction targets. The Rust extractor sees builder chains in source; it never encounters the headless component. No pipeline changes required.
- **Interop seams used**: data-*/aria-* passthrough (runtime/index.ts L152-154), selector aliases (selectors.ts), className merge via `.filter(Boolean).join(' ')` (runtime/index.ts L114-116), composeRefs for ref merging (runtime/index.ts L26-33)
- **Known limitation**: New files with Animus components require dev server restart (HMR gap, known since session 50)

## Open Questions

- Should headless primitives be exposed through compose() families or kept as internal implementation details behind convenience wrappers? (Note: compose() uses Animus's context mechanism; ark-ui has its own. Potential conflict surface for deeper integrations.)
- For future components beyond showcase (Dialog, Popover), should Animus provide pre-composed ark-ui wrappers or let consumers compose directly?
- Should we add new selector aliases for ark-ui-specific data attributes (e.g., `_open` → `[data-state="open"]`) to complement existing aliases?
