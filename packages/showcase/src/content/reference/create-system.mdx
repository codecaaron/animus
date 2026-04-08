# createSystem()

Initializes the design system for an application. Called once, typically in a `ds.ts` module. Returns a `SystemBuilder` with a chainable API that registers prop groups and builds the final system instance.

## Methods

### `.addGroup(name, config)`

```typescript
.addGroup(name: string, config: Record<string, Prop>)
```

Registers a named prop group. Props in the group become available on components that opt in via `.system({ [name]: true })`.

- Group name must not collide with individual prop names.
- Identical prop definitions across groups are tolerated (overlap tolerance).
- Conflicting prop definitions (same name, different config) throw at build time.

### `.addProps(config)`

```typescript
.addProps(config: Record<string, Prop>)
```

Registers individual props without a group name. These props are always available on components that call `.system()`.

- Prop names must not collide with group names.

### `.includes(systems)`

```typescript
.includes(systems: readonly SystemInstance[])
```

Merges serialized configs from other system instances. Used for sharing config across packages.

### `.build()`

```typescript
.build() → { system: SystemInstance, createGlobalStyles: GlobalStylesFactory }
```

Finalizes the system. Returns:

- **`system`** -- the Animus builder instance (typically aliased as `ds`).
- **`createGlobalStyles`** -- a factory for defining global CSS.

## Prop definition shape

Each entry in a group config is a `Prop` object:

```typescript
interface Prop {
  property: string;           // CSS property name (camelCase)
  properties?: string[];      // Additional CSS properties (for shorthands)
  scale?: string;             // Theme scale to resolve values from
  transform?: NamedTransform; // Value transform function (from createTransform)
  negative?: boolean;         // Allow negative scale values
  strict?: boolean;           // When false, accept arbitrary strings alongside scale keys (default: true)
}
```

## createGlobalStyles(styleMap)

Returned from `.build()`. Defines global CSS that emits to `@layer global`.

```typescript
const globalStyles = createGlobalStyles({
  '*, *::before, *::after': { boxSizing: 'border-box' },
  'html, body': { margin: 0, bg: 'background', color: 'text' },
});
```

- Takes a CSS object map (selectors to CSS objects).
- Returns a `GlobalStyleBlock` (branded type).
- Supports token refs (`'{scale.token}'`) in values.

## Pre-built groups

Available from `@animus-ui/system/groups`:

| Group | Contains |
|-------|----------|
| `space` | margin, padding shorthands |
| `color` | color, background-color, opacity |
| `typography` | font-size, font-weight, line-height, etc. |
| `flex` | flex-direction, align-items, justify-content, etc. |
| `border` | border, border-radius, border-color, etc. |
| `layout` | display, width, height, overflow, etc. |
| `grid` | grid-template, grid-gap, grid-area, etc. |
| `positioning` | position, top, right, bottom, left, z-index |
| `shadows` | box-shadow, text-shadow |
| `background` | background-image, background-size, etc. |
| `transitions` | transition, animation |

## Full example

```typescript
import { createSystem } from '@animus-ui/system';
import { color, space, typography, flex, border } from '@animus-ui/system/groups';

export const { system: ds, createGlobalStyles } = createSystem()
  .addGroup('surface', { ...color, ...border })
  .addGroup('text', { ...typography })
  .addGroup('space', space)
  .build();

export const globalStyles = createGlobalStyles({
  '*, *::before, *::after': { boxSizing: 'border-box' },
});
```
