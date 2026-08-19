# @animus-ui/showcase — Extraction Proof

The showcase is the integration proof that the static extraction pipeline works end-to-end, and the deployed docs/demo site (Cloudflare Worker `animus`, via `deploy:showcase`). Every component is built with `@animus-ui/system` (not `@animus-ui/core`, which is archived under `legacy/` — see root § Legacy Packages) and extracted at build time. There is no Emotion dependency.

## Source Structure

```
src/
  ds.ts                — Design system: createTheme() tokens + createSystem({ includes: [testDs] })
                         with six .addGroup() calls (surface, arrange, text, motion, space,
                         positioning), .declareContextualVars() (@property registration for
                         `--current-bg`), createKeyframes (`animations`), createGlobalStyles
  components/
    index.ts           — Barrel re-export. Load-bearing for the extractor's cross-file binding
                         resolution: Home and Shell import through it.
    decorative/        — FireLine, HorizontalMark, ReadingBarTrack
    docs/              — Doc-site components (Callout, TypeSignature, ParamTable, MethodCard,
                         ChainStep, CodeExample, APIBlock, Sidebar, MDXProvider, …). Several are
                         pinned by openspec specs (doc-atoms, doc-callout, doc-reference,
                         doc-interactive, narrative-components) — check specs
                         before deleting anything here.
    layout/            — CascadeLayer, Drawer, NavBar, Row, Scene, SkipLink, Stack
    surfaces/          — Card, RevealBlock, SyntaxBlock, Table, Tooltip
    typography/        — Display, InlineCode, Label, Logo, Mono, Prose, Strong
  constants/docsNav.ts — DOCS_NAV drives the router (App.tsx generates routes from it) and the
                         sidebar. A nav entry with no matching content/*.mdx renders NotFound —
                         keep it in sync with content/.
  content/**/*.mdx     — Doc pages. These are REAL extraction inputs: `.mdx` is in the pipeline's
                         DEFAULT_EXTENSIONS and file discovery ingests them on every build. The
                         `vite-extraction-plugin` spec pins this package's verify lane as the
                         end-to-end proof that MDX-rendered components extract.
  layout/              — DocsLayout (MDX chrome), Shell (app chrome), ScrollToTop
  lib/appearance.ts    — Thin wrapper over `@animus-ui/system/appearance` (the generic write path
                         lives there); owns only the showcase's own historical key name and its
                         one-shot migration
  pages/               — Home.tsx, Examples.tsx (the kitchen sink: button matrix, compose/portal
                         demos, test-ds external-package components, container queries, custom
                         prop transforms, selector aliases, asChild)
  App.tsx              — react-router route table (routes generated from DOCS_NAV + /docs/examples)
  main.tsx             — Entry point; imports `virtual:animus/styles.css`
```

## Design System (`src/ds.ts`)

- `createSystem({ includes: [testDs] }).addGroup(…)…build()` returns `{ system: ds, createGlobalStyles, createKeyframes }`. The `includes:` option is a DELIBERATE deprecation holdout (openspec: first-class-extension) — migrate consumers to `.extend(testDs)`, do not add new `includes:` usage.
- Tokens built separately via `createTheme()` and exported as `theme`; theme type augmented via `declare module`.
- Custom transforms: `fluid` (clamp-based, wired as `text.fluidSize`) and `ratio` (aspect-ratio, wired as `arrange.ratio`). NOTE: currently declared but unconsumed by any rendered component — `clamp(` does not appear in dist CSS.
- Keyframes: `animations = createKeyframes({ ember, flow, tallyPulse })`. Only `flow` is consumed (Logo.tsx, rendered by Home). The `assertKeyframesExtracted` pin in the assert lane depends on that single Logo→Home render path — if Home or Logo is slimmed, give Examples an `animationName` consumer first.
- Color modes: dark (default) + 9 additional via `[data-color-mode]`, with `systemPreference` (light→`light`, dark→`dark`) and a total `browserColorScheme` classification. Attribute ABSENCE means "follow the OS": the emitted `@media (prefers-color-scheme: …) { :root:not([data-color-mode]) { … } }` blocks select the mapped mode with no script running. Do not add modes casually: the appearance-bootstrap snippet grows with the mode list and `<meta charset>` must stay within the 1024-byte head budget (asserted).
- `.declareContextualVars({ colors: ['current-bg'] }, { … })` registers `@property --current-bg` — the assert lane pins its presence before the first `@layer` block.

## Emitted CSS shape

Layer order (assemble-stylesheet): `anm-global, anm-base, anm-variants, anm-compounds, anm-states, anm-system, anm-custom`, plus nested `standalone`/`composed` blocks and the `reset`/`overrides` layers declared in `vite.config.ts`. Class names are `animus-{Binding}-{hash}`, variants `…--{prop}-{value}`, states `…--{state}`. Color token vars are `--color-*` (singular).

## Verification

For verification commands, see root `AGENTS.md`. For the complete showcase-scoped proof, run `vp run @animus-ui/showcase#verify` (build + assert + credential-free Worker dry-run). The assertion file is `scripts/assert-showcase-build.ts` (repo root `scripts/`); it writes a receipt to `packages/showcase/.receipts/verify-assert-showcase.json`. Direct single-package dev/build commands (e.g., `bun run --filter './packages/showcase' build`) are available for inner-package iteration.

## Common Breakage Patterns

- **Global styles missing:** Restart the dev server. `buildStart` must re-run to re-evaluate the system module. See vite-plugin CLAUDE.md.
- **Stale Vite cache:** After pipeline changes, run `bun run clean:light` to clear `node_modules/.vite/`.
- **Components not extracting:** Check that components use `ds.styles()` (the system instance from `createSystem().build()`), not `animus.styles()` (from the archived `@animus-ui/core` in `legacy/`). The system builder is extraction-compatible; the legacy emotion-runtime builder is not.
- **CSS but no transforms applied:** Check for `__TRANSFORM__` placeholders in the output CSS. If present, transform resolution failed — check terminal warnings.
- **Component renders in dev but dropped from dist (e.g. `createPortal`/`createElement` usage):** If a component is rendered exclusively via `createElement(Component, ...)` (bare ident or member expression), it needs JSX scanner recognition of `CallExpression` forms. This was closed in `fix-selector-rule-extraction` Phase 1. Dev-mode surfaces this class of drop as a `[animus] ⚠ X would be eliminated in production` warning at authoring time — if you see that warning, the component isn't being recognized as rendered and the production build will drop its CSS.
- **Pass-through color props inside `_aliased`/`&:pseudo` blocks emit literal scale keys:** If `_focusVisible: { outlineColor: 'primary' }` produces `outline-color: primary;` instead of `outline-color: var(--color-primary)` in dist, the extractor's scale-lookup gate is missing the property. The color family (11 CSS color props) was closed in `fix-selector-rule-extraction` Phase 2; other families (length → space, etc.) are follow-on work.
- **Editing `vite.config.ts`:** the lane receipt's retirement guard reads it as raw text and throws on the token `engine:` anywhere in the file — comments included.

## Vite Config

`vite.config.ts` is NOT minimal: it runs the `@mdx-js/rollup` plugin (`enforce: 'pre'`, remark-gfm) ahead of `react()`, passes `verify: true, strict: true` and a layers array to `animusExtract({ system: './src/ds.ts' })`, and sets rollup output filename rules.

The showcase additionally passes `appearanceBootstrap: createAppearanceBootstrap(theme)`
(from `@animus-ui/system/bootstrap`), which the plugin injects as the first tag in
`<head>`. That generator is build tooling: importing it from anything under `src/`
would ship storage-access code into the app bundle. `index.html` carries no
hand-rolled pre-paint script — re-adding one reintroduces the flash the generated
snippet exists to prevent.
