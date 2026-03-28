# createSystem()

`createSystem(): SystemBuilder`

Creates a design system instance. The builder is evaluated once in a subprocess at build time — zero runtime cost. Returns a `SystemInstance` containing the `Animus` builder and a `serialize()` function.

### SystemBuilder Chain

| Method | Signature | Description |
|--------|-----------|-------------|
| `.withProperties(cb)` | `(cb: (PropertyBuilder) => { propRegistry, groupRegistry })` | Registers the property groups available on every component. `cb` receives a `PropertyBuilder` and must return `{ propRegistry, groupRegistry }`. |
| `.withGlobalStyles(styles)` | `({ reset?: Record<selector, css>, global?: Record<selector, css> })` | Injects global CSS. `reset` and `global` are both selector-to-CSS maps. |
| `.build()` | — | Returns a `SystemInstance` — the `Animus` builder object plus `serialize()`. |

### PropertyBuilder

| Method | Description |
|--------|-------------|
| `.addGroup(name, config)` | Registers a named group of style props. Groups are enabled per-component via `.groups()`. |
| `.build()` | Returns `{ propRegistry, groupRegistry }` to the system. |

```typescript
import { createSystem } from '@animus-ui/system';
import { space, color, typography, flex } from '@animus-ui/system/groups';

export const ds = createSystem()
  .withProperties((props) =>
    props
      .addGroup('space', space)
      .addGroup('text', typography)
      .addGroup('arrange', { ...flex })
      .addGroup('surface', { ...color })
      .build()
  )
  .withGlobalStyles({
    reset: { '*': { boxSizing: 'border-box' } },
    global: { 'html, body': { margin: 0, padding: 0 } },
  })
  .build();
```
