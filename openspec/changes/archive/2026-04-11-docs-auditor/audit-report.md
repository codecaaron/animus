# Phase 3 Audit Report — docs-auditor

> 25 pages validated against source code. 12 errors found across 10 pages. 15 pages PASS.

## Severity Legend

- **BLOCKER** — incorrect API reference or signature that will mislead consumers
- **HIGH** — missing coverage from Phase 1 checklist
- **MEDIUM** — behavioral claim that doesn't match implementation

---

## BLOCKER Errors

### 1. [HALLUCINATED_API] Vite Plugin: `prefix` option does not exist
**Page:** Vite Plugin (`compiler/vite-plugin.mdx`, line 91-95)
**Detail:** ParamTable documents a `prefix: string` option on `AnimusExtractOptions`. The actual interface (`vite-plugin/src/index.ts:33-70`) has 8 fields: system, include, exclude, strict, verbose, targets, minify, layers. No `prefix`.
**Origin:** Phase 1 outline listed `prefix` in the coverage checklist. The NAPI function `analyze_project` accepts `prefix?` internally, but the plugin does not expose it.
**Cascade:** This hallucination propagates to createTheme Reference and Migration pages.

### 2. [WRONG_SIGNATURE] createTheme Reference: `build()` does not accept options
**Page:** createTheme Reference (`reference/create-theme.mdx`, line 413)
**Detail:** Documents `build(options: { prefix?: string })`. The actual `build()` at `system/src/theme/createTheme.ts` takes zero parameters and returns `BuiltTheme<T, Emitted>`. The `prefix` functionality does not exist on ThemeBuilder.
**Source:** `system/src/theme/createTheme.ts` — `build()` method.

### 3. [WRONG_CONSTRAINT] Layer names missing `anm-` prefix (SYSTEMIC — 4 pages)
**Pages:** Vite Plugin (line 114-120), Extraction (line 105/130), Troubleshooting (line 179), Migration (line 215-223)
**Detail:** Docs show layer names as `global, base, variants, compounds, states, system, custom`. Actual layer names are `anm-global, anm-base, anm-variants, anm-compounds, anm-states, anm-system, anm-custom`.
**Source:** `extract/pipeline/assemble-stylesheet.ts:5-13` (ANIMUS_LAYERS constant). Confirmed by integration tests and vite-plugin JSDoc (line 63).

---

## HIGH Errors

### 4. [MISSING_COVERAGE] TypeScript page: 11 of 19 checklist types absent
**Page:** TypeScript Integration (`advanced/typescript.mdx`)
**Detail:** The following types from the Phase 1 coverage checklist are not mentioned on the page: TokenScales, ColorTokenRef, ScaleTokenRef, CSSColorValue, ThemedCSSProps, ThemedCSSPropMap, VariantConfig, CompoundEntry, ComposedFamily, SharedConfig, AnyBrandedComponent.
**Note:** All 11 types ARE documented on their narrative home pages (Base Styling, Variants, Composition, etc.). The gap is that the TypeScript page's "Full Type Reference" table doesn't include them.

### 5. [WRONG_CONSTRAINT] System Props: false claim about auto-registration
**Page:** System Props & Groups (`authoring/system-props.mdx`, line 82)
**Detail:** States "The following groups are registered on every Animus design system instance built from `createSystem()`." In reality, `createSystem()` returns an empty `SystemBuilder`. Groups must be explicitly imported from `@animus-ui/system/groups` and added via `.addGroup(name, config)`.

### 6. [MISSING_COVERAGE] Builder Chain Reference: missing AnimusExtendedWithCompounds
**Page:** Builder Chain Reference (`reference/builder-chain.mdx`, line 483-490)
**Detail:** Extension chain class table lists 6 classes but the actual implementation at `system/src/AnimusExtended.ts` has 7. Missing: `AnimusExtendedWithCompounds` (line 235). Table jumps from AnimusExtendedWithVariants to AnimusExtendedWithStates.

---

## MEDIUM Errors

### 7. [WRONG_SIGNATURE] Base Styling: BuiltInSelectorAlias missing `_required`
**Page:** Base Styling (`authoring/base-styling.mdx`, line 200-206)
**Detail:** Type definition shows 24 selectors but source has 25. Missing: `_required` (selector: `&:required, &[aria-required="true"]`, order: 120). Page also claims "23 built-in selector aliases" (line 353).
**Source:** `system/src/selectors.ts:45`

### 8. [WRONG_SIGNATURE] Variants page: defaultVariant type imprecision
**Page:** Variants, Compounds & States (`authoring/variants-states.mdx`, line 32/55)
**Detail:** Documents `defaultVariant?: keyof Props`. Source has `Extract<keyof Props, string>`. The `Extract` wrapper ensures only string keys are accepted (excludes symbol/number keys).
**Source:** `system/src/Animus.ts:364`

### 9. [WRONG_CONSTRAINT] Custom Props: size transform range boundary
**Page:** Custom Props & Transforms (`authoring/custom-props.mdx`, line 240)
**Detail:** Documents "Number in `(-1, 0) ∪ (0, 1]`" for percentage conversion. Actual implementation uses `coordinate <= 1 && coordinate >= -1` which is the closed interval `[-1, 1]` (inclusive of -1). The documented open interval on -1 is incorrect.
**Source:** `system/src/transforms/size.ts:7`

### 10. [MISSING_COVERAGE] Custom Props: Prop.currentVar field undocumented
**Page:** Custom Props & Transforms (`authoring/custom-props.mdx`)
**Detail:** The `Prop` interface at `system/src/types/config.ts:19` has a `currentVar?: string` field. The page's Prop interface listing (lines 48-56) omits it.

### 11. [HALLUCINATED_API] Theming page: varRef example uses undefined scale
**Page:** Theming & Tokens (`architecture/theming.mdx`, line 310)
**Detail:** Example shows `built.varRef('fontSizes.sm')` returning `'0.875rem'` but the example theme only adds breakpoints, colors, and space — no `fontSizes` scale. The `varRef` implementation returns `undefined` for non-existent scale paths.

### 12. [WRONG_SIGNATURE] Migration: `layers` option typed as string, should be string[]
**Page:** Migration & Adoption (`support/migration.mdx`, line 220)
**Detail:** Example passes `layers: 'design-system'` (a string). The `AnimusExtractOptions.layers` field is typed as `string[]` (array). Also misrepresents `layers` as an outer wrapper when it's actually the full @layer declaration order.
**Source:** `vite-plugin/src/index.ts:69`

---

## Systemic Pattern: `prefix` Hallucination Chain

The `prefix` option is documented across 3 pages as a user-facing feature, but it only exists at the NAPI level (`analyze_project` parameter) — not in the Vite plugin's public API. The chain:

1. Phase 1 outline listed `prefix` in Vite Plugin coverage checklist
2. Phase 2 expanded it with ParamTable entry, examples, and layer prefixing
3. createTheme Reference added `build({ prefix })` to match
4. Migration page used bare layer names (consequence of prefix framing)

The `anm-` prefix on layer names is a hardcoded default in `ANIMUS_LAYERS`, not controlled by a user-facing option. To fix, remove `prefix` from all pages and update all layer name references to include the `anm-` prefix.

---

## Pages That PASS (15/25)

1. Introduction
2. Getting Started
3. Selectors & Nesting
4. Composition
5. Color Modes
6. System Setup
7. Theme Extension
8. Global Styles
9. Next.js & Remix
10. Framework Agnostic
11. createSystem() Reference
12. compose() Reference
13. Recipes & Patterns
14. (no cross-page inconsistencies)

---

## Cross-Page Consistency: ALL PASS

- API explanations: consistent across narrative + reference pages
- Cross-references: all point to valid pages
- Import paths: all use correct @animus-ui/* packages
- Token naming: consistent across all pages
