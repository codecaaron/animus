## Why

The doc primitives (sessions 54-55) use ~6 inline SVG icons across CopyButton, Heading, ChainStep, and SyntaxBlock. These work but don't scale — adding new doc components or upgrading existing ones means hand-drawing SVGs each time. Separately, interactive patterns like MethodCard's accordion and TabGroup's tabs would benefit from headless UI primitives (ark-ui) for complete a11y behavior (focus trapping, roving tabindex beyond what we hand-rolled, proper ARIA state management).

Session 55 insight: the composition strategy is **asChild, not .asComponent()**. Instead of wrapping headless primitives inside Animus chains (extraction risk), Animus components delegate rendering TO the headless child via `asChild`. The ds element extracts normally; asChild merges classes onto the ark-ui element at the JSX boundary. Zero extraction risk.

## What Changes

### Track A — Icon System (lucide-react)

**Decision: lucide-react.** Pragmatic, tree-shakeable, 1400+ icons, zero design work. Not building a createIcon factory — that's infrastructure for a need that doesn't exist (showcase needs ~15 icons, not an icon system).

- Add `lucide-react` to showcase dependencies
- Replace inline SVGs in CopyButton (copy/check), Heading (link/check), SyntaxBlock (chevron), ChainStep (arrow connectors)
- Establish convention: import individual icons, use `currentColor` + size props, let Animus parent control color via tokens

~15 icons total across existing components. May discover more during implementation.

### Track B — Headless Composition Spike (ark-ui + asChild)

**Key insight:** `<StyledRoot asChild><Ark.Accordion.Root>...</Ark.Accordion.Root></StyledRoot>` — Animus provides extracted styles, ark-ui provides behavior. They compose at the JSX boundary.

**Spike scope:**
1. Add `@ark-ui/react` to showcase dependencies
2. Test asChild + ark-ui composition with ONE component: TabGroup → Ark Tabs
   - Does asChild class merging work with ark-ui's own class handling?
   - Does extraction still produce correct CSS when asChild is in play?
   - Does ark-ui's state management (aria-selected, focus) compose with Animus .states()?
3. If spike passes: migrate TabGroup fully, then MethodCard → Ark Accordion
4. If spike fails: document WHY and where the boundary is. Keep hand-rolled implementations.

**Components that would benefit if spike passes:**
- TabGroup → Ark Tabs (complete keyboard nav, focus management)
- MethodCard → Ark Accordion (proper accordion semantics, multi-expand control)
- Future: Dialog, Popover, Menu, Tooltip (replace our manual Tooltip)

## Capabilities

### New Capabilities
- `icon-convention`: lucide-react import pattern for showcase icons

### Modified Capabilities
- `doc-atoms`: CopyButton icons → lucide
- `doc-interactive`: TabGroup potential ark-ui migration, ChainStep icons → lucide
- `doc-reference`: MethodCard potential ark-ui Accordion migration
- `markdown-renderer`: Heading icons → lucide, SyntaxBlock icons → lucide

## Impact

- **New dependencies**: `lucide-react`, potentially `@ark-ui/react`
- **Risk**: ark-ui + asChild composition is unverified — spike first
- **No API changes**: Component props stay the same, only internals change
- **Extraction**: asChild approach keeps ds elements as normal extraction targets

## Open Questions

- Does ark-ui bundle reasonably with tree-shaking? (imports are per-component: `@ark-ui/react/accordion`)
- Does asChild correctly forward ark-ui's data-state attributes alongside Animus's data-state attributes? (potential attribute collision)
- Should we expose the ark-ui primitives through compose() families or keep them as internal implementation details behind convenience wrappers?
