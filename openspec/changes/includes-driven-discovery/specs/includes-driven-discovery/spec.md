# includes-driven-discovery

Plugin discovers external packages by reading the system entry file's import declarations instead of scanning all source files.

## Requirements

### REQ-1: System file import extraction

The plugin reads the system entry file (the `system` option path) and extracts all top-level import specifiers.

**Scenarios:**

- WHEN the system file contains `import { ds as testDs } from '@animus-ui/test-ds'`
  THEN `@animus-ui/test-ds` is in the discovered specifier set

- WHEN the system file contains `import { createSystem } from '@animus-ui/system'`
  THEN `@animus-ui/system` is filtered out (it's the framework, not an external DS)

- WHEN the system file contains `import { space } from '@animus-ui/system/groups'`
  THEN `@animus-ui/system/groups` is filtered out

- WHEN the system file contains `import { ds as a } from '@ds-a/core'` and `import { ds as b } from '@ds-b/core'`
  THEN both `@ds-a/core` and `@ds-b/core` are in the discovered set

### REQ-2: Package resolution and file walking

For each discovered specifier, the plugin resolves it to a source directory and walks it for component files. This behavior is unchanged from the current implementation.

**Scenarios:**

- WHEN `@animus-ui/test-ds` is discovered
  THEN the plugin resolves it via the bundler's resolver, finds the package root, targets `src/`, and walks for `.ts/.tsx/.js/.jsx` files excluding `.test./.spec./node_modules/dist`

- WHEN a specifier fails to resolve
  THEN the plugin silently skips it (no error thrown)

### REQ-3: No all-file scan

The plugin does NOT scan all discovered source files for import specifiers. Package discovery reads only the system entry file.

**Scenarios:**

- WHEN a component file imports from `@animus-ui/test-ds` but ds.ts does NOT import from it
  THEN the package is NOT discovered (consumer must add `.includes()`)

- WHEN ds.ts imports from `@animus-ui/test-ds` via `.includes([testDs])`
  THEN the package IS discovered regardless of whether any other file imports from it

### REQ-4: Plugin parity

Both vite-plugin and next-webpack-plugin use the same discovery mechanism.
