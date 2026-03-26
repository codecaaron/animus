# @animus-ui/showcase — Extraction Proof

The showcase is the integration proof that the static extraction pipeline works end-to-end. Every component is built with `@animus-ui/system` (not `@animus-ui/core`) and extracted at build time. There is no Emotion dependency.

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

- `createSystem()` → `.withProperties()` → `.withGlobalStyles()` → `.build()`
- Tokens built separately via `createTheme()` and exported as `tokens`. Theme type augmented via `declare module`.
- Custom transforms: `fluid` (clamp-based responsive), `ratio` (aspect-ratio)
- Global styles: reset (box-sizing, normalize) + global (bg/color on html/body, scrollbar, selection)
- Color modes: dark (default) + light via `[data-color-mode]`
- Fonts: Instrument Serif (display), Newsreader (body), IBM Plex Mono (mono)

## Verification

```bash
# Build the showcase (from repo root)
bun run test:showcase

# Or from this directory
bun run build

# Full pipeline verification
bun run verify:showcase
```

### What to check in the output
- **Bundle size:** ~277KB JS (gzipped ~80KB). No Emotion runtime.
- **CSS file:** Should contain `@layer global`, `@layer base`, `@layer variants`, `@layer states`, `@layer system`
- **No Emotion imports:** `grep -r "@emotion" dist/` should return nothing
- **Class names:** All components use `animus-ComponentName-hash` pattern

## Common Breakage Patterns

- **Global styles missing:** Restart the dev server. `buildStart` must re-run to re-evaluate the system subprocess. See vite-plugin CLAUDE.md.
- **Vite resolve aliases:** NEVER add React or other resolve aliases to `vite.config.ts`. They silently break the transform pipeline. See: `feedback_no_react_alias` memory.
- **Stale Vite cache:** After pipeline changes, run `bun run clean:light` to clear `node_modules/.vite/`.
- **Components not extracting:** Check that components use `ds.styles()` (from `@animus-ui/system`), not `animus.styles()` (from `@animus-ui/core`). The system builder is extraction-compatible.
- **CSS but no transforms applied:** Check for `__TRANSFORM__` placeholders in the output CSS. If present, the transform resolution subprocess failed — check terminal warnings.

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
