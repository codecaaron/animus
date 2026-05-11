# Pages — Functional Spec

## 1. Home (`/`)

### Purpose
First impression. Communicate what Animus is and why a developer should care, in under 10 seconds of scanning.

### Functional Requirements

- **Headline**: Library name + one-line descriptor conveying zero-runtime CSS extraction from TypeScript
- **Input/Output demonstration**: Side-by-side or sequential display showing:
  - The authored TypeScript (builder chain defining a component)
  - The generated CSS output (layered, atomic, zero-runtime)
  - This is the single most important element on the page — it makes the extraction model concrete
- **Key differentiators**: 3-5 short statements covering:
  - Zero runtime (no style injection, no recalc)
  - Type-safe (IDE knows every valid token)
  - Cascade layers (specificity solved by architecture)
  - Rust extraction (OXC-based, fast)
  - Design tokens (scales, color modes, responsive)
- **Call to action**: Link to Getting Started (`/docs/start`)
- **Secondary link**: Link to Why Animus (`/docs`) for deeper motivation

### Content Tone
Direct, confident, technical. Not marketing fluff. Show the code, state the facts.

### Extraction Features Exercised
- Layout components (Stack, Row, Slab)
- Typography components (Display, Prose, Label, Mono)
- Code display (SyntaxBlock)
- Responsive props (font sizes, spacing)

---

## 2. Why Animus (`/docs`)

### Purpose
Explain the motivation. Name the problem, explain the approach, differentiate from alternatives. A developer who reads this page should understand WHY this library exists and whether it's right for their use case.

### Functional Requirements

- **The problem statement**: CSS-in-JS libraries (Emotion, styled-components) provided excellent DX — colocated styles, dynamic values, design tokens — but at the cost of runtime performance. Style injection on every render, serialization overhead, and incompatibility with React Server Components killed them.
- **The failed alternatives**: Utility-first (Tailwind) solved the runtime problem but abandoned the component abstraction. CSS Modules solved scoping but lost token integration and type safety. The developer was forced to choose between DX and performance.
- **The Animus approach**: Keep the authoring model (TypeScript, builder chain, design tokens, variants) but move ALL work to build time. A Rust pipeline walks the AST, resolves every value, and emits static CSS. The JavaScript disappears. What ships is platform CSS with zero runtime cost.
- **The cascade contract**: Explain that each builder method maps to a CSS `@layer`. This isn't an implementation detail — it's the core architectural idea. Specificity is flat. Position in the cascade determines precedence. The TypeScript authoring and the CSS output operate on separate planes.
- **When to use / when NOT to use**:
  - Use when: building a React application with a design system, you want type-safe tokens and zero runtime
  - Don't use when: you need fully dynamic styles computed at runtime from user input, you're not using React, you're not using Vite

### Content Tone
Narrative. Name the crisis, explain the response, be honest about tradeoffs.

### Extraction Features Exercised
- Layout components
- Typography
- Possibly color mode demonstration (showing dark/light context)

---

## 3. Getting Started (`/docs/start`)

### Purpose
Zero to styled component in 5 minutes. A developer following this page should have a working Animus setup by the end.

### Functional Requirements

- **Prerequisites**: State that the developer needs: React 18+, Vite 5+, bun (or npm/yarn — but examples use bun)
- **Step 1 — Install**:
  ```
  bun add @animus-ui/system @animus-ui/vite-plugin
  ```
  Show only the two consumer packages. No internal packages.
- **Step 2 — Configure Vite**:
  ```typescript
  import { animusExtract } from '@animus-ui/vite-plugin';
  import react from '@vitejs/plugin-react';
  import { defineConfig } from 'vite';

  export default defineConfig({
    plugins: [react(), animusExtract({ system: './src/ds.ts' })],
  });
  ```
  Explain: `system` points to the file that exports your design system instance.
- **Step 3 — Create your design system** (`src/ds.ts`):
  - Show a minimal createTheme() with a few colors and a space scale
  - Show createSystem() with one or two prop groups
  - Explain: this file is the single source of truth for your design language
  - Show the Theme augmentation (`declare module '@animus-ui/system'`)
- **Step 4 — Import the virtual stylesheet**:
  ```typescript
  import 'virtual:animus/styles.css';
  ```
  In main.tsx or App.tsx. Explain: this virtual module contains all extracted CSS.
- **Step 5 — Build your first component**:
  ```typescript
  const Button = ds
    .styles({ display: 'inline-flex', alignItems: 'center', px: 16, py: 8, bg: 'primary', color: 'background' })
    .variant({ prop: 'size', variants: { sm: { px: 8, py: 4, fontSize: 12 }, lg: { px: 24, py: 12, fontSize: 18 } } })
    .asElement('button');
  ```
  Show usage: `<Button size="sm">Click me</Button>`
- **Step 6 — Build and verify**:
  ```
  bun run build
  ```
  Show expected output: CSS file with `@layer base { ... } @layer variants { ... }`. Point out: zero JavaScript for styling. The component renders with class names.

### Content Tone
Instructional, concise. Each step is one action with one code block. No tangents.

### Extraction Features Exercised
- Code display (multiple SyntaxBlock instances with different languages)
- Sequential layout (Stack with ordered steps)
- InlineCode for package names, file paths, function names

---

## 4. Core Concepts (`/docs/concepts`)

### Purpose
Teach the mental model. After reading this page, a developer should understand: the builder chain, the cascade contract, design tokens, responsive props, and variants/states.

### Functional Requirements

#### Section: The Builder Chain
- Show the full chain: `ds.styles().variant().states().groups().asElement()`
- Explain each method's role:
  - `.styles()` — base CSS declarations → `@layer base`
  - `.variant()` — named variant options → `@layer variants`
  - `.compound()` — conditional styles when multiple props match → `@layer compounds`
  - `.states()` — boolean state toggles → `@layer states`
  - `.groups()` — prop group bundles (space, arrange, text, etc.) → `@layer system`
  - `.asElement()` — seals the chain, returns a React component
- Show input/output: the builder chain code alongside the generated CSS with @layer annotations
- Explain: the chain is fully type-safe. After .variant(), the returned component's props include the variant prop with its valid values.
- Mention `.extend()`: any sealed component can be extended via `.extend()`, which returns a new builder chain pre-populated with the parent's configuration.

#### Section: The Cascade Contract
- List the 7 layers in order: `global → base → variants → compounds → states → system → custom`
- Explain: specificity is flat (all selectors are single class). Layer position determines which styles win.
- Explain: this means `.states()` always overrides `.compound()` which always overrides `.variant()` which always overrides `.styles()`. No `!important` needed. No specificity wars.
- Show a concrete example: a component with a base background, a variant that changes it, a compound condition, and a state that overrides all.

#### Section: Design Tokens
- Explain createTheme() and scales (space, colors, fontSizes, etc.)
- Show how token values are referenced: `bg: 'primary'` resolves through the color mode system to a CSS custom property
- Explain color modes: `addColorModes('dark', { dark: {...}, light: {...} })` — semantic tokens that resolve differently per mode
- Explain token aliasing: `{colors.ember/40}` syntax for alpha-modified color references
- Show the generated CSS: `:root { --color-primary: ... }` and `[data-color-mode=light] { --color-primary: ... }`

#### Section: Responsive Props
- Explain the breakpoint-object syntax: `fontSize={{ _: 14, md: 24 }}`
- `_` is the base (no media query), named keys map to breakpoints defined in createTheme()
- Show generated CSS: base declaration + `@media (width >= 1024px) { ... }`
- Explain: this works for any prop exposed via `.groups()`. It's not special syntax — it's how the system-layer props resolve.

#### Section: Variants & States
- **Variants**: Named options on a single prop. Show a 3-option variant (size: sm/md/lg) with the generated CSS.
- **Compound Variants**: Conditions that apply when multiple props match. Show a compound variant with its condition and the generated `@layer compounds` CSS.
- **States**: Boolean toggles. Show a `disabled` state and its generated `@layer states` CSS.
- For each, show input (builder chain) → output (CSS).

### Content Tone
Explanatory, progressive. Start with the builder chain as the backbone, then layer on each concept. Code-heavy with annotations.

### Extraction Features Exercised
- Code display (multiple languages: tsx, css)
- Headings with anchors (section navigation within page)
- Tables (layer order reference)
- Responsive props on layout
- InlineCode throughout

---

## 5. API Reference (`/docs/api`)

### Purpose
Lookup reference. A developer who knows the concepts comes here to check function signatures, parameters, and return types.

### Functional Requirements

#### Section: createTheme()
- Signature: `createTheme(config) → ThemeBuilder`
- Config: `{ breakpoints }` — required, defines responsive breakpoints
- Chain methods:
  - `.addScale(name, factory)` — add a token scale (space, colors, fontSizes, etc.)
  - `.addColors(colors)` — add raw color tokens
  - `.addColorModes(defaultMode, modes)` — define semantic color aliases per mode
  - `.build()` — seal and return the theme object
- Show a complete example with 2-3 scales, colors, and color modes

#### Section: createSystem()
- Signature: `createSystem() → SystemBuilder`
- Chain methods:
  - `.withProperties(configurator)` — define prop groups via the PropertyBuilder
  - `.withGlobalStyles(styles)` — define global CSS (reset, base, keyframes)
  - `.build()` — seal and return the SystemInstance
- PropertyBuilder methods:
  - `.addGroup(name, props)` — define a named prop group
  - `.build()` — seal the property configuration
- Explain: the system is evaluated at build time in a subprocess. It has zero runtime cost.

#### Section: Builder Chain (ds.styles → .asElement)
- `.styles(declarations)` — base CSS object. Properties can use prop shorthand (bg, px, py, etc.) and token references.
- `.variant({ prop, variants, defaultVariant? })` — named variant with options mapping to CSS objects
- `.compoundVariant({ conditions, css })` — conditional styles when multiple props match. Conditions can be arrays for multi-match.
- `.states({ [name]: css })` — boolean state toggles
- `.groups({ [groupName]: true })` — enable prop group bundles
- `.props({ [propName]: config })` — custom dynamic props (runtime CSS custom properties)
- `.asElement(tag)` — seal the chain, return a typed React component
- `.asComponent(Component)` — seal the chain, wrap an existing React component

#### Section: createTransform()
- Signature: `createTransform(name, fn) → Transform`
- Purpose: custom value transformation for props (e.g., fluid typography, aspect ratios)
- Show example: the `fluid` transform that generates `clamp()` values

#### Section: Prop Groups (from @animus-ui/system/groups)
- List all available groups with their CSS properties:
  - `space` — margin, padding (all directional variants)
  - `color` — color, backgroundColor, opacity
  - `typography` — fontSize, fontFamily, fontWeight, lineHeight, letterSpacing, textAlign
  - `layout` — width, height, display, overflow, min/max variants
  - `flex` — alignItems, justifyContent, flexDirection, flexWrap, flex, gap
  - `grid` — gridTemplateColumns/Rows, gridColumn/Row, gridGap
  - `border` — border, borderWidth, borderColor, borderRadius
  - `background` — background, backgroundImage, backgroundSize, backgroundPosition
  - `shadows` — boxShadow, textShadow
  - `positioning` — position, top/right/bottom/left, zIndex
  - `transitions` — transition, transitionProperty/Duration/TimingFunction

#### Section: Vite Plugin
- `animusExtract(options)` — the Vite plugin factory
- Options:
  - `system: string` — path to the system module (required)
  - `strict?: boolean` — throw on extraction failures (default false)
  - `verbose?: boolean` — enable debug logging
  - `packagePatterns?: string[]` — workspace packages to include in extraction
  - `prefix?: string` — namespace prefix for all generated class names and CSS variables
  - `layers?: string[]` — custom @layer declaration (must contain all 6 Animus layers as subsequence)
  - `minify?: boolean` — enable CSS minification via Lightning CSS (default true in production)

### Content Tone
Reference-style. Function signatures, parameter tables, short examples. Not narrative — lookup-oriented.

### Extraction Features Exercised
- Tables (parameter/option tables)
- Code display (signatures, examples)
- Headings with anchors (deep linking to specific APIs)
- Lists (prop group property lists)
- InlineCode throughout
