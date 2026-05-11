## 1. Project Setup

- [x] 1.1 Created `packages/showcase/` with workspace deps
- [x] 1.2 `vite.config.ts` using `animusExtract()` — 10 lines, zero config
- [x] 1.3 `index.html` with color mode init script + Google Fonts
- [x] 1.4 `tsconfig.json` extending root with `jsx: "react-jsx"`
- [x] 1.5 Reset CSS in `@layer reset` imported before virtual CSS

## 2. Theme

- [x] 2.1 `src/theme.ts` using `createTheme` with stone/indigo/violet/pink palette, light/dark modes
- [x] 2.2 Theme auto-detected by plugin via `src/theme.ts` convention
- [x] 2.3 Built CSS contains `:root` variables and `[data-color-mode="dark"]` overrides

## 3. Component Library (29 components extracted)

- [x] 3.1 Primitives: Box (with grid group), Stack, Row, Container, Section
- [x] 3.2 Typography: Heading (responsive h1-h4 variants), Text (size variants), Code, Label
- [x] 3.3 Interactive: Button (primary/secondary/ghost/small + disabled), SmallButton (extension chain)
- [x] 3.4 Surfaces: Card (interactive state), FeatureCard (extension), Badge (5 variants), Divider, ColorSwatch
- [x] 3.5 Custom vocabulary: Panel, Arrange, GridArrange, Prose, Chip using regrouped config via `createAnimus()`

## 4. Frontend Design

- [x] 4.1 DM Serif Display + DM Sans + JetBrains Mono typography
- [x] 4.2 Sections: Hero, Features (3 cards), Buttons, Badges, Typography specimen, Color palette, Custom vocabulary, Pipeline (4 cards), Footer
- [x] 4.3 Color mode toggle in header
- [x] 4.4 Responsive grid layouts via `cols` system prop (gridItemRatio transform)

## 5. Verification

- [x] 5.1 `npx vite build` succeeds — 29 components extracted, 14KB CSS (3.5KB gzipped)
- [x] 5.2 All 91 tests pass
- [x] 5.3 Color mode toggle works in built output
- [x] 5.4 Gaps documented: custom transform resolution, polymorphic `as` prop, ESM/lodash interop
