## Why

After decoupling theming from system (change 1: `absorb-theming-into-system`), theme tokens and system config are separate exports. For local development this is fine — the plugin config points to a file path. But for distributed design systems (`@company/design-system` consumed by app teams), the plugin needs a way to discover where tokens and system config live.

Additionally, consumers need a guaranteed single entry point that: (a) ensures their theme and system modules are in Vite's module graph for HMR propagation, (b) anchors the virtual stylesheet import, and (c) provides a hook for color mode runtime.

## What Changes

- **Rename runtime to `@animus-ui/react`**: The existing runtime package becomes the React-specific entry point. `createComponent` and ref forwarding stay. New: `AnimusProvider`.
- **AnimusProvider component**: A typed import-anchor component exported from `@animus-ui/react`. Accepts `theme` (typed as `Theme`) and `system` (typed as `SystemInstance`) props. Renders children only — no React context, no runtime wrapping. The props exist to force consumers to import their theme and system modules, creating edges in the module graph.
- **Typed prop enforcement**: The `theme` prop is typed against the augmented `Theme` interface. If the consumer hasn't properly augmented `Theme`, TypeScript catches the mismatch at the provider callsite.
- **Plugin detection (future)**: The plugin can scan for `AnimusProvider` usage in JSX, trace the `theme` and `system` prop bindings back to their source modules, and auto-configure without explicit path config.

## Capabilities

### New Capabilities
- `animus-provider`: AnimusProvider component as typed import-anchor for distributed design system consumption
- `react-package`: Rename runtime to `@animus-ui/react`, add AnimusProvider, runtime becomes internal dependency

### Modified Capabilities
- `vite-extraction-plugin`: Plugin gains ability to load tokens/system from module exports discovered via AnimusProvider (alongside existing file path config)

## Impact

- **runtime package**: Renamed to `@animus-ui/react`. Published as `@animus-ui/react`. Runtime's `createComponent` becomes an internal implementation detail.
- **Consumer API**: `import { AnimusProvider } from '@animus-ui/react'` in app root. `import { createComponent } from '@animus-ui/react'` still works (re-exported).
- **Plugin config**: Gains support for package specifier (`system: '@company/design-system'`) in addition to file paths.
- **Showcase**: Updates to import from `@animus-ui/react` instead of `@animus-ui/runtime`.
- **Hardcoded runtime import in Rust**: `transform_emitter.rs` currently emits `@animus-ui/runtime` — must change to `@animus-ui/react`.

## Progression

This is change 2 of 2. Depends on change 1 (`absorb-theming-into-system`) which decouples tokens from SystemBuilder and makes the plugin load tokens from module exports.
