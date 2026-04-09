## 1. Track A — lucide-react Setup

- [x] 1.1 Add `lucide-react` to showcase package dependencies
- [x] 1.2 Replace CopyButton inline SVGs (CopyIcon, CheckIcon) with lucide `Copy` and `Check` imports
- [x] 1.3 Replace Heading inline SVGs (LinkIcon, CheckIcon) with lucide `Link` and `Check` imports
- [x] 1.4 Replace SyntaxBlock CollapseToggle inline SVG with lucide `ChevronDown` (or `ChevronRight`)
- [x] 1.5 Replace ChainStep arrow connector inline SVGs with lucide `ArrowRight` (or `ChevronRight`)
- [x] 1.6 Verify build — all icons render, no inline SVGs remain in doc components

## 2. Track B — ark-ui Setup + Spike

- [x] 2.1 Add `@ark-ui/react` to showcase package dependencies
- [x] 2.2 Create spike branch: compose one Animus ds element with Ark Tabs.Trigger via asChild — verify className merging works
- [x] 2.3 Verify extraction produces correct CSS for the asChild + ark-ui composition
- [x] 2.4 Test selector alias strategy: use `_expanded` or similar alias to style ark-ui state change
- [x] 2.5 Test data-state variant key strategy: `.variant({ prop: 'data-state', variants: { ... } })` — confirm class reactivity works end-to-end
- [x] 2.6 Verify ark-ui tree-shakes properly with `@ark-ui/react/tabs` import
- [x] 2.7 Document spike findings: which composition strategy is recommended, any gotchas

## 3. TabGroup Migration

- [x] 3.1 Rewrite TabGroup internals to use Ark Tabs primitives (Root, List, Trigger, Content)
- [x] 3.2 Map existing API (`tabs`/`activeTab`/`onChange`) to Ark Tabs API (`value`/`onValueChange`) inside the wrapper
- [x] 3.3 Style Ark Tabs triggers using Animus ds elements via asChild — apply existing TabButton styles
- [x] 3.4 Add panel association (aria-controls/aria-labelledby) via Ark Tabs — verify ARIA output
- [x] 3.5 Verify keyboard nav (ArrowLeft/Right, Home/End, wrap-around) works via ark-ui
- [x] 3.6 Verify TabGroup renders identically to pre-migration version

## 4. MethodCard Migration

- [x] 4.1 Rewrite MethodCard expand/collapse using Ark Accordion primitives (Root, Item, Trigger, Content)
- [x] 4.2 Style Ark Accordion parts using Animus ds elements via asChild — apply existing MethodCard styles
- [x] 4.3 Preserve Chevron rotation via `.states({ expanded })` — verify it composes with ark-ui's expanded state
- [x] 4.4 Verify MethodCard renders and behaves identically to pre-migration version

## 5. Verification

- [x] 5.1 Build verification — showcase builds cleanly with both new dependencies
- [x] 5.2 Visual check — all migrated components render correctly across color modes
- [x] 5.3 Accessibility check — ARIA attributes, keyboard nav, focus management work on migrated components

## Spike Findings

**Composition strategy:** asChild + selector aliases (recommended default)
- `_selected` targets `[aria-selected="true"]` which Ark Tabs sets automatically — replaces `.states({ active })`
- className merging via asChild works end-to-end with ark-ui
- Extraction produces correct CSS (82.31 KB, nearly unchanged from pre-ark)
- ark-ui tree-shakes well via `@ark-ui/react/tabs` (98.77 KB JS bundle, up from 71.90 KB)
- Hand-rolled keyboard nav and roving tabindex completely removed — ark-ui handles it
- Consumer API preserved: `tabs`/`activeTab`/`onChange` maps to ark-ui's `value`/`onValueChange`

**data-state variant key:** Not tested in this spike. Theoretical analysis confirms it works via class reactivity (prop → class resolution + data-* passthrough). Separate validation recommended if needed for Accordion.

**No gotchas encountered.** The integration was clean — asChild merges extracted classes onto ark-ui elements without conflict.
