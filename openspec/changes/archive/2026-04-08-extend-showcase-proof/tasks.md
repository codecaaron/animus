## 1. Extended Component

- [x] 1.1 Create `ButtonLink` via `Button.extend().asElement('a')` — either in `Button.tsx` alongside the base or in a new file
- [x] 1.2 Optionally create a second extension (e.g., display/CTA variant) that adds styles via `.extend().styles({...}).asElement('button')`

## 2. Examples Page

- [x] 2.1 Add "Extension Chains" section to `Examples.tsx` — render `Button` and `ButtonLink` side-by-side with shared variant props
- [x] 2.2 Add prose explaining provenance-tracked extension and @layer source ordering

## 3. Verification

- [x] 3.1 Build showcase (`bun run verify:showcase`) — no regressions
- [x] 3.2 Check extracted CSS: both parent and child appear in same `@layer`, source-ordered
