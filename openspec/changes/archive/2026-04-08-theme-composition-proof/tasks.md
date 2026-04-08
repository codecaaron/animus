## 1. Docs Content

- [x] 1.1 Create `packages/showcase/src/content/architecture/theme-extension.md` — document `.from()` (full extension), additive patterns (`.addColors()` / `.addScale()` after `.from()`), selective spread (`addColors({ ...libTokens.colors })`), and the `.from()` vs `.includes()` distinction
- [x] 1.2 Add "Theme Extension" nav entry in `packages/showcase/src/constants/docsNav.ts` under Architecture section

## 2. Showcase Examples

- [x] 2.1 Add "Theme Composition" section to `packages/showcase/src/pages/Examples.tsx` — code example showing `createTheme().from(referenceTokens).addColors({...}).build()`, prose explaining deep merge behavior, positioned after "External Package Components"
- [x] 2.2 Render test-ds `Button` and `Card` in the section with prose explaining they were authored against a different reference theme but render correctly via compatible token contract

## 3. Verification

- [x] 3.1 Build showcase (`bun run verify:showcase`) — no regressions
- [x] 3.2 Visual check: theme composition section renders, test-ds components display correctly
