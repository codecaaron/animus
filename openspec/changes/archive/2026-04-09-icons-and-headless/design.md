## Context

Session 55 shipped a polish pass on 12 doc-primitive components, establishing idiomatic Animus patterns (.states(), compose(), selector aliases, _focusVisible). The components now use the ds system correctly but still carry two debts: hand-drawn inline SVGs (~6 icons across 4 components) and hand-rolled interactive a11y (TabGroup keyboard nav, MethodCard accordion semantics).

Animus's runtime was intentionally designed with headless library interop seams: data-*/aria-* attribute passthrough, selector aliases matching both ARIA and data-attribute conventions, className merging via asChild/asComponent, and ref composition via composeRefs(). These seams are proven in tests but unvalidated with an actual headless library.

The competitive landscape confirms this architecture works: Panda CSS + Ark UI ships static extraction + headless composition in production (Chakra v3, Park UI). Animus's layered extraction model (`@layer base, variants, compounds, states`) provides a cascade contract that atomic approaches (Panda, Tailwind) lack.

## Goals / Non-Goals

**Goals:**
- Replace inline SVGs with lucide-react icons across CopyButton, Heading, SyntaxBlock, ChainStep
- Validate ark-ui composition via a TabGroup → Ark Tabs spike
- Document recommended composition patterns (asChild + selector aliases as default)
- Migrate TabGroup and MethodCard to ark-ui if spike passes
- Maintain stable consumer APIs — no breaking changes to component props

**Non-Goals:**
- Building a createIcon factory or icon system abstraction
- Modifying the extraction pipeline or Rust crate
- Exposing ark-ui primitives as public API (they're internal implementation details)
- Pre-emptively wrapping ark-ui components we don't need yet (Dialog, Popover, etc.)
- Adding new selector aliases for ark-ui attributes (evaluate after spike)

## Decisions

### Decision 1: lucide-react for icons

**Choice:** Import individual lucide-react icons within component files. No re-export layer, no icon registry.

**Why:** ~15 icons needed. A createIcon factory or centralized icon system is infrastructure for a need that doesn't exist. lucide-react tree-shakes per-icon via named imports. Icons are implementation details of the components that use them — CopyButton exports `<CopyButton>`, not `<CopyIcon>`.

**Alternatives considered:**
- Custom SVG sprite sheet — overhead for 15 icons, no tree-shaking benefit
- @iconify/react — larger API surface, more config, same end result
- Keep inline SVGs — doesn't scale, 30+ lines per icon pair

### Decision 2: asChild as recommended composition path

**Choice:** Use `asChild` as the default way to compose Animus ds elements with ark-ui primitives. Document `asComponent` and `as` as escape hatches.

**Why:** asChild provides the cleanest prop boundary — Animus variant/state props never conflict with headless component props because they're on different elements in the JSX tree. The Animus element extracts normally; asChild merges its resolved classes onto the headless child.

**Alternatives considered:**
- asComponent — works, but prop shapes must be compatible. Viable when the headless component's props are known and non-conflicting. Document as escape hatch.
- as prop — runtime polymorphism, least type-safe. Good for one-off overrides.
- All three are polymorphism — the choice is ergonomic, not functional.

### Decision 3: Selector aliases as recommended state styling strategy

**Choice:** Use existing selector aliases (`_expanded`, `_checked`, `_disabled`, etc.) to style ark-ui state changes. These already match both `[aria-expanded="true"]` and `[data-expanded]` conventions.

**Why:** Works today, type-safe, covers common headless states. No extraction changes needed. Falls within established `@layer` cascade.

**Alternatives considered:**
- Manual selectors (`'&[data-state="open"]'`) — works, verbose, use when no alias exists
- data-state as variant key (`.variant({ prop: 'data-state' })`) — works via class reactivity (prop → class resolution each render, prop also passes through to DOM as data-attribute). More integrated but mechanism is less obvious. Document as advanced pattern after spike validates.

### Decision 4: Convenience wrappers over exposed primitives

**Choice:** Keep ark-ui primitives as internal implementation details behind the existing component APIs. TabGroup stays `<TabGroup tabs={[...]} activeTab="x" onChange={fn}>`, not `<Ark.Tabs.Root>`.

**Why:** Consumer API stability. Components are used across showcase MDX pages. Exposing ark-ui primitives would leak the dependency and create a coupling that makes swapping headless libraries costly.

### Decision 5: Spike-first for Track B

**Choice:** Implement Track A (icons) first, then spike Track B (headless) with TabGroup only before committing to full migration.

**Why:** Track A is zero-risk drop-in replacement. Track B architecture is proven (Panda+Ark) but Animus-specific extraction behavior needs validation. The spike answers: does className merging work end-to-end through extraction + asChild + ark-ui? One component proves or disproves the pattern.

## Risks / Trade-offs

**[ark-ui bundle size]** → Mitigated by per-component deep imports (`@ark-ui/react/tabs`). Verify tree-shaking during spike.

**[ark-ui API churn]** → ark-ui is pre-1.0. Pin version, wrap behind convenience components. If API changes, only wrapper internals change, not consumer code.

**[TabGroup API delta]** → Ark Tabs uses `value`/`onValueChange` internally. Current TabGroup uses `activeTab`/`onChange`. Wrapper absorbs the mapping. Zero consumer-facing change.

**[HMR new-file gap]** → New files with Animus components require dev server restart (known issue since session 50). Creating new wrapper files during implementation will hit this. Accept and restart.

**[compose() + headless context]** → compose() uses Animus's context mechanism for shared variant propagation. ark-ui has its own React context. These could conflict in deeper integrations (e.g., composed families wrapping multiple ark-ui parts). Scoped to future concern — current components use compose() OR ark-ui, not both simultaneously.
