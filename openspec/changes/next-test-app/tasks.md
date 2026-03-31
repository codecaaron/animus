## 1. Package Scaffold

- [ ] 1.1 Create `packages/next-test-app/` directory with `package.json` (private, deps: next, react, react-dom, @animus-ui/system, @animus-ui/next-plugin)
- [ ] 1.2 Add `tsconfig.json` extending root (jsx: preserve for Next.js)
- [ ] 1.3 Create `next.config.ts` with `withAnimus({ system: './src/ds.ts' })`
- [ ] 1.4 Add `packages/next-test-app` to root workspaces
- [ ] 1.5 Add `.animus/` to `.gitignore` in the package directory

## 2. Design System

- [ ] 2.1 Create `src/ds.ts` — `createTheme()` with colors (~5 entries), space (0/4/8/16), fontSizes (14/16/20/24), breakpoints (sm/md/lg), 1 color mode (dark)
- [ ] 2.2 Create system via `createSystem().addGroup(space).addGroup(layout).addGroup(text).withGlobalStyles(reset).build()`
- [ ] 2.3 Export `ds` (SystemInstance), `tokens` (ThemeBuilder result), and `compose` from `@animus-ui/system`
- [ ] 2.4 Add `declare module '@animus-ui/system'` theme augmentation

## 3. Component Fixtures

- [ ] 3.1 Create `src/components/Box.tsx` — base styles + system props (space, layout)
- [ ] 3.2 Create `src/components/Button.tsx` — size + intent variants, hover + disabled states
- [ ] 3.3 Create `src/components/Badge.tsx` — size + intent variants + compound (size:small + intent:danger)
- [ ] 3.4 Create `src/components/Card.tsx` — variant with named transform (size → padding scale)
- [ ] 3.5 Create `src/components/Stack.tsx` — layout with responsive system props in JSX
- [ ] 3.6 Create `src/components/Family.tsx` — compose() with Root + Child, shared size variant
- [ ] 3.7 Create `src/components/index.ts` — barrel re-export all components

## 4. App Router Pages

- [ ] 4.1 Create `app/layout.tsx` — root layout, imports CSS stylesheet, html + body wrapper
- [ ] 4.2 Create `app/page.tsx` — RSC page (no "use client"), renders Box, Button, Card, Stack, Badge, Family
- [ ] 4.3 Create `app/client/page.tsx` — "use client", useState for variant toggling on Button (size cycles on click)
- [ ] 4.4 Verify `app/page.tsx` does NOT contain "use client" directive

## 5. Pages Router

- [ ] 5.1 Create `pages/_app.tsx` — custom App, imports CSS stylesheet
- [ ] 5.2 Create `pages/legacy.tsx` — renders Box, Button, Family (same components as App Router)
- [ ] 5.3 Verify shared components (Box, Button) imported by both routers

## 6. Post-Build Assertions

- [ ] 6.1 Create `scripts/assert-next-build.sh` — grep-based assertions on .next/ output
- [ ] 6.2 Assert: CSS contains `@layer base` and `@layer variants`
- [ ] 6.3 Assert: JS/HTML output contains `animus-` class name pattern
- [ ] 6.4 Assert: no `@emotion` in JS bundles
- [ ] 6.5 Assert: no `__TRANSFORM__` in CSS output
- [ ] 6.6 Assert: both App Router and Pages Router output directories exist
- [ ] 6.7 Add `test:next` script to root package.json (build + assert)

## 7. Verification

- [ ] 7.1 Run `next build` from the package — confirm it completes without errors
- [ ] 7.2 Run assertion script — all assertions pass
- [ ] 7.3 Run `next dev` — verify pages render in browser (manual check, not automated)
- [ ] 7.4 Verify HMR: edit a component's variant value → CSS updates without full reload
