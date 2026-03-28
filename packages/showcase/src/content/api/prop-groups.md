# Prop Groups

`@animus-ui/system/groups` exports 13 pre-built property group definitions. These are plain objects you compose freely inside `.addGroup()`. Each key in a group object is a prop name; its value describes the CSS property, optional token scale, and optional transform.

| Export | Props | Covers |
|--------|-------|--------|
| `color` | 12 | color, background-color, opacity, fill, stroke and variants |
| `border` | 23+ | border, border-radius, border-color, border-style, outline and shorthands |
| `flex` | 16+ | flex, flex-direction, align-items, justify-content, flex-wrap, order, gap and shorthands |
| `grid` | 21+ | grid-template-columns/rows, grid-column/row, gap, place-items and shorthands |
| `background` | 6+ | background, background-image, background-size, background-position, background-repeat |
| `positioning` | 8 | position, top, right, bottom, left, z-index, inset |
| `shadows` | 3 | box-shadow, text-shadow, drop-shadow |
| `layout` | 20+ | width, height, min/max-width, min/max-height, overflow, display, aspect-ratio and shorthands |
| `typography` | 9+ | font-family, font-size, font-weight, line-height, letter-spacing, text-transform, text-align |
| `space` | 14 | margin, padding, gap shorthand props (m, p, mx, my, px, py, etc.) |
| `transitions` | 3 | transition, transition-property, transition-duration |
| `mode` | 1 | color-scheme / color-mode switching prop |
| `vars` | 1 | Arbitrary CSS custom property passthrough |

### Composing Groups

Spread multiple raw groups to create purpose-built supergroups.

```typescript
import { color, border, shadows, background } from '@animus-ui/system/groups';

props.addGroup('surface', {
  ...color,
  ...border,
  ...shadows,
  ...background,
})
```
