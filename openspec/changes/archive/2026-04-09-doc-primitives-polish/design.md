## Context

12 doc-primitive components were shipped in session 54. A seam audit compared them against the gold standard surface components (Button, Card, Tooltip) and the full ds API surface (builder chain, selector aliases, compose, states). The audit found 5 categories of corrections needed, all using existing ds features that were either unknown or skipped during rapid implementation.

Key reference patterns:
- **Card**: `compose()` with `{ shared: { density: true } }` for slot families
- **Button**: Multi-axis variants, color scheme rebinding, `.system({ space: true })`
- **Tooltip**: `compose()` with `context: true` for portal-crossing
- **Drawer**: `.states({ open })` for CSS-driven visibility
- **RevealBlock**: `.states({ visible })` for CSS-driven animation
- **PageToc**: `.states({ active })` for active link highlighting

## Goals / Non-Goals

**Goals:**
- Every doc component uses `.states()` where it toggles visual state based on a boolean
- Every slot family with shared variant axes uses `compose()`
- Every interactive element has `_focusVisible` styles
- Playwright baseline captures the kitchen sink in all 10 color modes
- Components that could consolidate multiple ds definitions into one variant do so

**Non-Goals:**
- Icon system changes (inline SVGs stay — separate spike)
- ark-ui integration (separate spike)
- MethodCard → compose() (no shared variant axis, conditional rendering is correct)
- borderRadius additions (radii: 0 is intentional)
- Visual design changes (colors, spacing, fonts)
- New components or features

## Decisions

### Decision 1: States over inline styles — the universal pattern

**Choice:** Replace all `style={{ transform: ... }}` and `style={{ opacity: ..., color: ... }}` patterns with `.states()`.

**Why:** `.states()` generates `data-state-*` attributes that the extraction pipeline processes into `@layer states` CSS. Inline styles bypass extraction entirely — they're invisible to the cascade contract. The existing Drawer, RevealBlock, and PageToc all demonstrate the pattern.

**How:** For each affected element, add a `.states()` call to the chain and pass the boolean as a prop:
```ts
// Before
<Chevron style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>
// After  
const Chevron = ds.styles({ ... }).states({ expanded: { transform: 'rotate(180deg)' } }).asElement('span');
<Chevron expanded={expanded}>
```

**Components:** ChainStep (StepLabel, LayerLabel), Heading (AnchorButton), MethodCard (Chevron), SyntaxBlock (CollapseToggle, SyntaxPre)

### Decision 2: compose() for Callout only

**Choice:** Migrate Callout to `compose()`. Do NOT migrate MethodCard.

**Why Callout:** Container, Icon, and Title share the identical variant axis (`variant: info|tip|warn|danger`) with identical option names. Currently the variant is passed 3 times in JSX. This is the textbook `compose()` case — Card does the same thing with `density`.

**Why NOT MethodCard:** MethodCard has 8 sub-elements but no shared variant axis. The expand/collapse is handled via conditional rendering (`{expanded && <DetailSection>}`), which is correct for performance — conditional rendering doesn't mount the DOM until needed. Forcing compose() here would require always mounting the detail section and hiding it via CSS, which is a worse tradeoff.

**Implementation:**
```ts
export const Callout = compose(
  { Root: CalloutContainer, Header: CalloutHeader, Icon: CalloutIcon, Title: CalloutTitle, Body: CalloutBody },
  { shared: { variant: true } }
);
```

**MDXProvider impact:** The componentMap entry changes from `Callout` (function component) to using `Callout.Root` as the outer element. The `Callout` export from Callout.tsx becomes a convenience wrapper that uses the composed family internally.

### Decision 3: TypeSignature consolidation — 6 elements to 1 variant

**Choice:** Replace 6 single-purpose styled spans with one `TokenSpan` element that has a `role` variant.

**Why:** NameSpan, GenericSpan, PunctSpan, ParamNameSpan, ParamTypeSpan, ReturnSpan differ only in `color`. This is exactly what variants are for — switching a CSS property based on a prop value.

```ts
const TokenSpan = ds
  .styles({ fontWeight: 700 })
  .variant({
    prop: 'role',
    variants: {
      name: { color: 'primary', fontWeight: 700 },
      generic: { color: '{colors.violet.400}' },
      punct: { color: 'text.dim', fontWeight: 400 },
      param: { color: '{colors.ocean.500}' },
      paramType: { color: '{colors.violet.400}' },
      return: { color: '{colors.forest.500}' },
    },
  })
  .asElement('span');
```

### Decision 4: Heading — CSS-only hover, proper button element

**Choice:** Three changes in one component:
1. Replace JS onMouseEnter/onMouseLeave with `_hover: { '& [data-anchor]': { opacity: '0.5' } }` on HeadingWrapper
2. Replace inline style copied feedback with `.states({ copied })` on AnchorButton  
3. Change AnchorButton from `<span role="button" tabIndex={0}>` to `<button>` element

**Why:** The SyntaxBlock CopyOverlay already demonstrates the CSS-only hover-reveal pattern with `_hover: { '& [data-copy-overlay]': { opacity: '1' } }`. The Heading should use the same approach. The span-with-role-button is semantically incorrect and misses native keyboard handling (Enter/Space).

### Decision 5: TabGroup keyboard navigation

**Choice:** Implement the WAI-ARIA Tabs pattern with roving tabindex.

**Implementation:**
- Only the active tab has `tabIndex={0}`, inactive tabs have `tabIndex={-1}`
- ArrowLeft/ArrowRight move focus and activate the adjacent tab
- Home/End jump to first/last tab
- Wrap around at boundaries

**Why:** The existing `role="tablist"` and `role="tab"` attributes set up the ARIA contract but don't fulfill it — keyboard users currently can't navigate between tabs without Tab key, which is incorrect per WAI-ARIA.

### Decision 6: Playwright verification — mode sweep, not pixel-perfect

**Choice:** Screenshot the kitchen sink page in all 10 color modes as a verification pass, not a pixel-perfect regression suite.

**Why:** The goal is to catch contrast/token issues across modes (e.g., a color that works in dark mode but disappears in light mode). This is a one-time audit that produces screenshots for human review, not an automated CI gate.

**Implementation:** Playwright script that navigates to `/docs/support/component-test`, sets `data-color-mode` attribute, captures full-page screenshot per mode.

## Risks / Trade-offs

**[Callout compose() changes JSX usage]** → The convenience wrapper function (`export function Callout()`) is preserved with the same props API. Internal implementation changes to use the composed family. MDXProvider componentMap continues to reference the wrapper, not the raw family. Zero breaking changes for MDX authors.

**[States on Chevron/CollapseToggle may produce different animation timing]** → `.states()` applies styles via data-attributes in `@layer states`. The `transition` property on the base element handles animation. Test that rotation transitions still animate smoothly after the change.

**[TypeSignature TokenSpan variant may generate more CSS than 6 separate elements]** → Each variant option generates a CSS rule. 6 rules in one class vs 6 separate classes. Net CSS output is similar. Extraction handles both correctly.

**[TabGroup keyboard nav adds React complexity]** → useCallback + onKeyDown handler. Contained to TabGroup component, does not leak. The pattern is well-established (WAI-ARIA Tabs spec).
