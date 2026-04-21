# @animus-ui/showcase — Extraction Proof

The showcase is the integration proof that the static extraction pipeline works end-to-end. Every component is built with `@animus-ui/system` (not `@animus-ui/core`, which is archived under `legacy/` — see root § Legacy Packages) and extracted at build time. There is no Emotion dependency.

## Source Structure

```
src/
  ds.ts               — Design system: createSystem() with tokens, prop groups, global styles
  components/
    index.ts           — Barrel re-export (named exports, tests import resolver)
    layout/            — Scene, Slab, Stack, Row, StratumRow, EmberDivider
    typography/        — Display, Prose, Mono, Label, SectionLabel, Accent, Strong
    surfaces/          — CodeBlock, SyntaxBlock, Callout, RevealBlock
    decorative/        — GradientBar, ReadingBarTrack, GoldDash, VerticalBleed, HorizontalMark, Divider
  App.tsx              — Main app (The Excession — 8 chromatic worlds)
  main.tsx             — Entry point
  global.css           — Keyframe animations (not extractable via prop shorthand)
  reset.css            — Legacy reset (superseded by .withGlobalStyles, still on disk but NOT imported)
```

Each component is in its own file (1 named export per file). This structure exercises:
- **Barrel re-exports** — import resolver follows `./components` → `index.ts` → individual files
- **Per-file HMR** — changing one component only invalidates that file, not all 22
- **Subdirectory file discovery** — plugin's recursive walk finds files in nested dirs

## Design System (`src/ds.ts`)

- `createSystem().addGroup().build()` returns `{ system: ds, createGlobalStyles }`
- `createGlobalStyles()` is a factory returned from `.build()`, used to define global/reset styles
- Tokens built separately via `createTheme()` and exported as `tokens`. Theme type augmented via `declare module`.
- Custom transforms: `fluid` (clamp-based responsive), `ratio` (aspect-ratio)
- Global styles: reset (box-sizing, normalize) + global (bg/color on html/body, scrollbar, selection)
- Color modes: dark (default) + 9 additional modes via `[data-color-mode]`
- Fonts: IBM Plex Mono (display/mono), Geist (body)

## Verification

For verification commands, see root `CLAUDE.md` § Verification Tiers. For showcase-scoped proof, run `bun run verify:showcase` (build + assert). Direct single-package dev/build commands (e.g., `bun run --filter './packages/showcase' build`) are available for inner-package iteration.

### What to check in the output
- **Bundle size:** ~277KB JS (gzipped ~80KB). No Emotion runtime.
- **CSS file:** Should contain `@layer global`, `@layer base`, `@layer variants`, `@layer states`, `@layer system`
- **No Emotion imports:** `grep -r "@emotion" dist/` should return nothing
- **Class names:** All components use `animus-ComponentName-hash` pattern

## Common Breakage Patterns

- **Global styles missing:** Restart the dev server. `buildStart` must re-run to re-evaluate the system subprocess. See vite-plugin CLAUDE.md.
- **Vite resolve aliases:** NEVER add React or other resolve aliases to `vite.config.ts`. They silently break the transform pipeline.
- **Stale Vite cache:** After pipeline changes, run `bun run clean:light` to clear `node_modules/.vite/`.
- **Components not extracting:** Check that components use `ds.styles()` (the system instance from `createSystem().build()`), not `animus.styles()` (from the archived `@animus-ui/core` in `legacy/`). The system builder is extraction-compatible; the legacy emotion-runtime builder is not.
- **CSS but no transforms applied:** Check for `__TRANSFORM__` placeholders in the output CSS. If present, the transform resolution subprocess failed — check terminal warnings.
- **Component renders in dev but dropped from dist (e.g. `createPortal`/`createElement` usage):** If a component is rendered exclusively via `createElement(Component, ...)` (bare ident or member expression), it needs JSX scanner recognition of `CallExpression` forms. This was closed in `fix-selector-rule-extraction` Phase 1. Dev-mode now surfaces this class of drop as a `[animus] ⚠ X would be eliminated in production` warning at authoring time — if you see that warning, the component isn't being recognized as rendered and the production build will drop its CSS.
- **Pass-through color props inside `_aliased`/`&:pseudo` blocks emit literal scale keys:** If `_focusVisible: { outlineColor: 'primary' }` produces `outline-color: primary;` instead of `outline-color: var(--color-primary)` in dist, the extractor's scale-lookup gate is missing the property. The color family (11 CSS color props) was closed in `fix-selector-rule-extraction` Phase 2; other families (length → space, etc.) are follow-on work.

## Vite Config

```typescript
// vite.config.ts — minimal, no resolve aliases
export default defineConfig({
  plugins: [
    react(),
    animusExtract({ system: './src/ds.ts' }),
  ],
});
```
