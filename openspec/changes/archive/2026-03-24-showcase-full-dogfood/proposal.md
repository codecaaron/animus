## Why

The showcase manifesto still had escape hatches: `className="ember-glow"` referencing CSS classes, `@keyframes` in a separate `global.css` file, and a `pre[style]` override. The DEFINE_EXAMPLE code string also showed the wrong variant API (Stitches-style positional args instead of Animus config object). A manifesto that doesn't fully dogfood the system undermines the message. Every remaining CSS file and raw className is a contradiction.

## What Changes

- `@keyframes` definitions moved into `.withGlobalStyles({ global: { '@keyframes ember': {...}, ... } })` — the global styles pipeline now handles nested at-rule serialization
- Animation CSS classes (`.ember-glow`, `.tally-number`) eliminated — `animation` property used directly as a system prop on Display (via `motion: true` group)
- `pre[style]` override moved into `.withGlobalStyles()` global block
- `global.css` and `reset.css` deleted — zero CSS files in the showcase
- `global.css` import removed from `main.tsx`
- DEFINE_EXAMPLE string corrected: `.variant('elevation', {...})` → `.variant({ prop: 'elevation', variants: {...} })`
- Display component gains `motion: true` in its groups for `animation` system prop access

## Capabilities

### Modified Capabilities
- `showcase-manifesto`: Full dogfooding — zero CSS files, zero raw classNames, zero inline styles. Everything through the system.

## Impact

- **Showcase** (`packages/showcase/`): `global.css` and `reset.css` deleted. `main.tsx` imports only `virtual:animus/styles.css`. `App.tsx` uses `animation` prop instead of `className`. `components.tsx` adds `motion: true` to Display. `ds.ts` gains keyframe + pre[style] definitions in global styles.
