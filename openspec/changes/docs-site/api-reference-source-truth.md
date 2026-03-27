# API Reference — Source Truth

Compiled from actual source code exploration. Every signature, parameter name, and type
is copied directly from the source. Use this as the ONLY source for docs content.

---

## createTheme(base)

**File:** `packages/system/src/theme/createTheme.ts:472-474`

```typescript
export function createTheme<T extends AbstractTheme>(base: T): ThemeBuilder<T>
```

### ThemeBuilder Methods

#### .addScale(key, createScale)
**File:** `createTheme.ts:398-420`
- `key: string` — scale name
- `createScale: (theme: T) => Record<string | number, string | number | Record<string, string | number>>` — factory receiving current theme
- Returns: new `ThemeBuilder` with scale merged

#### .addColors(colors)
**File:** `createTheme.ts:286-314`
- `colors: Record<string, CSSColorValue | Record<string, CSSColorValue>>` — color tokens (nested ok)
- Validates all values are valid CSS colors (hex, rgb, hsl, oklch, named, etc.)
- Generates CSS variables: `--color-{key}`
- Returns: new `ThemeBuilder` with colors merged

#### .addColorModes(initialMode, modeConfig)
**File:** `createTheme.ts:322-390`
- `initialMode: keyof Config` — default mode key (must exist in modeConfig)
- `modeConfig: Record<string, Record<string, keyof colors>>` — mode alias mappings
- Validates all aliases reference existing color keys
- Initial mode → `:root {}`, other modes → `[data-color-mode="{mode}"] {}`
- Returns: new `ThemeBuilder`

#### .createScaleVariables(key)
**File:** `createTheme.ts:255-279`
- `key: keyof Omit<T, 'breakpoints'>` — scale to convert to CSS variables
- Not used in showcase

#### .updateScale(key, updateFn)
**File:** `createTheme.ts:428-438`
- `key: keyof T` — scale to update
- `updateFn: (tokens: T[key]) => Record<string | number, unknown>` — merge new values
- Not used in showcase

#### .build()
**File:** `createTheme.ts:447-469`
- Returns finalized theme object
- Generates breakpoint CSS variables
- Attaches non-enumerable `.manifest` property (ThemeManifest for plugin)

---

## createSystem()

**File:** `packages/system/src/SystemBuilder.ts:141-143`

```typescript
export function createSystem(): SystemBuilder<{}, {}>
```

### SystemBuilder Methods

#### .withProperties(cb)
**File:** `SystemBuilder.ts:38-53`
- `cb: (p: PropertyBuilder) => { propRegistry, groupRegistry }` — configurator callback
- Callback receives `PropertyBuilder`, must return object with both registries

#### .withGlobalStyles(styles)
**File:** `SystemBuilder.ts:55-59`
- `styles: GlobalStylesConfig` — `{ reset?: Record<string, Record<string, any>>, global?: Record<string, Record<string, any>> }`

#### .build()
**File:** `SystemBuilder.ts:61-77`
- Returns: `SystemInstance` (Animus instance + `serialize()` method)

### PropertyBuilder Methods

#### .addGroup(name, config)
**File:** `packages/system/src/PropertyBuilder.ts:15-28`
- `name: string` — group name (developer's choice)
- `config: Record<string, Prop>` — prop configs for this group
- Returns: new `PropertyBuilder` (immutable)

#### .build()
**File:** `PropertyBuilder.ts:30-35`
- Returns: `{ propRegistry, groupRegistry }`

---

## Builder Chain (ds.styles → .asElement)

**File:** `packages/system/src/Animus.ts`

Class hierarchy: `Animus → AnimusWithBase → AnimusWithVariants → AnimusWithCompounds → AnimusWithStates → AnimusWithSystem → AnimusWithAll`

### .styles(config)
**File:** `Animus.ts:476-484`
- `config: ThemedCSSProps` — CSS declarations with prop shorthand and token refs
- Emits: `@layer base`
- Returns: `AnimusWithBase` (unlocks .variant)

### .variant(options)
**File:** `Animus.ts:402-428`
```typescript
{
  prop?: string;              // defaults to 'variant' if omitted
  defaultVariant?: string;    // key of variants to apply by default
  base?: ThemedCSSProps;      // shared styles across all options
  variants: Record<string, ThemedCSSProps>;  // named options → CSS
}
```
- Emits: `@layer variants`
- Can call .variant() multiple times (chainable)
- Returns: `AnimusWithVariants`

### .compound(condition, styles)
**File:** `Animus.ts:323-340`
- `condition: Record<string, string | ReadonlyArray<string>>` — variant prop → value(s) to match
- `styles: ThemedCSSProps` — CSS when condition matches
- Emits: `@layer compounds`
- Can call .compound() multiple times
- Returns: `AnimusWithCompounds`

### .states(config)
**File:** `Animus.ts:342-359`
- `config: Record<string, ThemedCSSProps>` — state name → CSS
- Emits: `@layer states`
- Returns: `AnimusWithStates`

### .groups(config)
**File:** `Animus.ts:279-298`
- `config: Record<string, true>` — group names → true
- Emits: `@layer system`
- Returns: `AnimusWithSystem`

### .props(config)
**File:** `Animus.ts:232-251`
- `config: Record<string, Prop>` — custom prop definitions
- Each Prop: `{ property: CSSProperty, scale?: string | MapScale | ArrayScale, transform?: fn, negative?: boolean, variable?: string }`
- Emits: `@layer custom`
- Returns: `AnimusWithAll`

### .asElement(tag)
**File:** `Animus.ts:107-123`
- `tag: keyof JSX.IntrinsicElements` — HTML element tag
- Returns: typed React component (ForwardRefExoticComponent) with `.extend()` method

### .asComponent(Component)
**File:** `Animus.ts:125-142`
- `Component: (props: { className?: string }) => any` — existing React component
- Returns: wrapped component with `.extend()` method
- Note: does NOT activate group props on the wrapped component

### .asClass()
**File:** `Animus.ts:144-147`
- No parameters
- Returns: `(props?: Record<string, unknown>) => string` — class name resolver function

### .build()
**File:** `Animus.ts:149-171`
- No parameters
- Returns: parser function with `.extend()` method

### .extend()
**File:** `Animus.ts:86-105` (on AnimusWithAll, also on sealed components)
- No parameters
- Returns: `AnimusExtended` — new builder pre-populated with parent config
- Key behavior: `.styles()` MERGES with parent (deepMerge), `.groups()` MERGES (additive), `.props()` MERGES

---

## createTransform(name, fn)

**File:** `packages/system/src/transforms/createTransform.ts:12-17`

```typescript
createTransform(name: string, fn: TransformFn): NamedTransform
```
- `TransformFn = (value: string | number, property?: string, props?: AbstractProps) => string | number | CSSObject`
- Returns fn with `.transformName` property attached

---

## Prop Groups (from @animus-ui/system/groups)

**File:** `packages/system/src/groups/index.ts`

13 exported groups:

| Group | Props (count) | Key properties |
|-------|--------------|----------------|
| color | 12 | color, bg, gradient, borderColor, fill, stroke |
| border | 23+ | border, borderX/Y, borderWidth, borderRadius, rounded, borderStyle |
| flex | 16+ | flexDirection, flexDir, flexWrap, flex, justifyContent, alignItems, gap, order |
| grid | 21+ | gridTemplateColumns, cols, rows, flow, alignAll, gap |
| background | 6+ | background, backgroundImage, bgImage, bgSize, bgPos, bgRepeat |
| positioning | 8 | position, pos, inset, top, right, bottom, left, zIndex, opacity |
| shadows | 3 | boxShadow, shadow, textShadow |
| layout | 20+ | display, overflow, size, w, h, minW, maxW, minH, maxH, verticalAlign |
| typography | 9+ | fontFamily, fontWeight, lineHeight, fontSize, letterSpacing, textAlign, fontStyle, textDecoration, textTransform, whiteSpace |
| space | 14 | m, mx, my, mt, mb, mr, ml, p, px, py, pt, pb, pr, pl |
| transitions | 3 | transition, animation, animationPlayState |
| mode | 1 | mode |
| vars | 1 | vars |

---

## Vite Plugin

**File:** `packages/vite-plugin/src/index.ts:27-75, 403`

```typescript
export function animusExtract(options: AnimusExtractOptions): Plugin
```

### AnimusExtractOptions

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| system | string | Yes | — | Path to SystemInstance module |
| include | string[] | No | .ts/.tsx/.js/.jsx | Glob patterns to include |
| exclude | string[] | No | — | Glob patterns to exclude |
| packagePatterns | string[] | No | ['@animus-ui/*'] | Package patterns to resolve |
| strict | boolean | No | false | Throw on extraction failures |
| verbose | boolean | No | false | Debug logging (or ANIMUS_DEBUG=1) |
| targets | string \| string[] | No | browserslist → 'defaults' | CSS autoprefixing targets |
| minify | boolean | No | undefined (prod only) | CSS minification control |
| prefix | string | No | none | Namespace prefix for vars + classes |
| layers | string[] | No | 7 Animus layers | Full @layer declaration order |

### Other Exports
- `evaluateTheme(ssrLoadModule, themePath)` — evaluate theme via Vite SSR
- `evaluateThemeObject(theme)` — evaluate already-loaded theme object
- `default` = `animusExtract`

---

## Cascade Layers (7 total)

```
global → base → variants → compounds → states → system → custom
```

Specificity is flat (single class selectors). Layer position determines precedence.
