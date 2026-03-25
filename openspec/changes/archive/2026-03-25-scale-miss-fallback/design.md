## Context

The Rust extraction pipeline emits CSS declarations with raw numeric values when a scale lookup misses: `padding: 8` instead of `padding: 8px`. The transform post-processing step in the Vite plugin already does a linear scan of the CSS to resolve `__TRANSFORM__` placeholders. Adding unit fallback to this same pass is zero additional complexity.

## Goals / Non-Goals

**Goals:**
- Bare numeric values on length properties get `px` appended
- Unitless properties (lineHeight, opacity, zIndex, fontWeight, etc.) are preserved as-is
- Same behavior as Emotion / React DOM's unitless handling
- Applied in both in-memory and subprocess code paths

**Non-Goals:**
- Other unit types (em, rem, %) — those come from scale resolution or transforms
- Validating that the value is sensible (e.g., `fontSize: -5` → `font-size: -5px` is technically valid CSS)
- Changing the Rust crate's output

## Decisions

### 1. Unitless property set matches @emotion/unitless

The canonical set (~50 properties): `animationIterationCount`, `borderImageOutset`, `borderImageSlice`, `borderImageWidth`, `boxFlex`, `boxFlexGroup`, `boxOrdinalGroup`, `columnCount`, `columns`, `flex`, `flexGrow`, `flexPositive`, `flexShrink`, `flexNegative`, `flexOrder`, `gridArea`, `gridRow`, `gridRowEnd`, `gridRowSpan`, `gridRowStart`, `gridColumn`, `gridColumnEnd`, `gridColumnSpan`, `gridColumnStart`, `fontWeight`, `lineClamp`, `lineHeight`, `opacity`, `order`, `orphans`, `tabSize`, `widows`, `zIndex`, `zoom`, `fillOpacity`, `floodOpacity`, `stopOpacity`, `strokeDasharray`, `strokeDashoffset`, `strokeMiterlimit`, `strokeOpacity`, `strokeWidth`.

Store as a `Set<string>` of kebab-case names for direct matching against CSS output.

### 2. Regex-based detection on emitted CSS

The CSS at post-processing time is structured declarations: `property: value;`. A regex matches `([a-z-]+):\s*(-?\d+\.?\d*);` — property name, colon, bare number, semicolon. If the property is NOT in the unitless set, append `px`.

Edge cases:
- Negative values: `-8` → `-8px` ✓ (regex includes optional `-`)
- Decimal values: `0.5` → `0.5px` ✓ (regex includes optional `.d+`)
- Zero: `0` → `0` (no unit needed, `0px` === `0`) — could special-case but both are valid CSS
- Values already with units: `8px`, `1rem` — won't match the bare-number regex ✓
- CSS variable values: `var(--x)` — won't match ✓
- Shorthand properties: `margin: 8 16` — each number needs unit. Regex matches per-declaration, not per-value within a declaration. **This needs a per-value replacement within matched declarations.**

### 3. Implementation as a standalone function

```typescript
const UNITLESS = new Set([
  'animation-iteration-count', 'border-image-outset', 'border-image-slice',
  'border-image-width', 'box-flex', 'box-flex-group', 'box-ordinal-group',
  'column-count', 'columns', 'flex', 'flex-grow', 'flex-positive',
  'flex-shrink', 'flex-negative', 'flex-order', 'grid-area', 'grid-row',
  'grid-row-end', 'grid-row-span', 'grid-row-start', 'grid-column',
  'grid-column-end', 'grid-column-span', 'grid-column-start',
  'font-weight', 'line-clamp', 'line-height', 'opacity', 'order',
  'orphans', 'tab-size', 'widows', 'z-index', 'zoom',
  'fill-opacity', 'flood-opacity', 'stop-opacity',
  'stroke-dasharray', 'stroke-dashoffset', 'stroke-miterlimit',
  'stroke-opacity', 'stroke-width',
]);

function applyUnitFallback(css: string): string {
  return css.replace(
    /([a-z-]+):\s*([^;]+);/g,
    (match, prop, value) => {
      if (UNITLESS.has(prop)) return match;
      const fixed = value.replace(
        /(?<![a-z%])(-?\d+\.?\d+)(?![a-z%\d])/g,
        '$1px'
      );
      return fixed !== value ? `${prop}:${fixed};` : match;
    }
  );
}
```

Called after transform resolution in both code paths.

## Risks / Trade-offs

**False positive on non-length numeric values** → Shorthand properties like `border: 1 solid red` would get `border: 1px solid red`. In this case that's actually correct. But `transition: opacity 0.3 ease` would become `transition: opacity 0.3px ease` — wrong. → Mitigated: transition durations typically have `s` or `ms` units already. If a bare `0.3` appears in a transition, it's already broken CSS. The fallback makes it less broken, not more.

**Zero handling** → `0` doesn't need `px` but `0px` is equally valid. Not worth special-casing.
