## Context

System (`@animus-ui/system`) is the zero-runtime, static-extraction authoring surface. Its only dependency on theming is a single import: `createTheme` used in `SystemBuilder.withTokens()`. Theming (`@animus-ui/theming`) depends on core (`@animus-ui/core`), which depends on `@emotion/react`, `@emotion/styled`, and `@emotion/is-prop-valid`. This creates a transitive dependency chain that pulls Emotion into system's consumer install.

Theming's source is 4 files (~450 lines) that are entirely Emotion-free. The only imports from core are 3 trivial type definitions (`AbstractTheme`, `CSSObject`, `BaseTheme`).

`SystemBuilder.withTokens()` is unnecessary ceremony — in practice consumers already build tokens separately and pass them through unchanged. Module augmentation on `Theme` handles type drilling. SystemBuilder doesn't need tokens at all.

The plugin currently loads tokens via `ds.serialize().tokens`. This coupling is artificial — the tokens are already available as a separate module export.

## Goals / Non-Goals

**Goals:**
- Eliminate system's transitive dependency on `@emotion/*`
- Move theming source into system as internal modules with locally-defined types
- Remove `withTokens()` from SystemBuilder entirely — no `T` generic, no `#tokens`, no tokens in `serialize()`
- Update plugin subprocess to load tokens from module exports
- Re-export `createTheme`, `ThemeBuilder`, and associated utilities from `@animus-ui/system`

**Non-Goals:**
- Deleting the theming package (remains for legacy core/Emotion path)
- AnimusProvider or distribution story (change 2)
- Renaming runtime to `@animus-ui/react` (change 2)
- Removing lodash dependency from moved files
- Changing ThemeBuilder API or behavior

## Decisions

### 1. Move files vs. rewrite
**Decision**: Move theming's 4 source files into `system/src/theme/` with import updates.

**Rationale**: The code works. Rewriting working code to produce identical output is waste.

### 2. Type localization
**Decision**: Add `AbstractTheme` and `CSSObject` to `system/src/types/theme.ts`.

**Alternatives**: Shared `@animus-ui/types` package (adds boundary), import types from core (still pulls Emotion into dep tree).

**Rationale**: These types are trivial (1-3 lines each). Duplicating is cheaper than a package boundary.

### 3. SystemBuilder loses tokens entirely
**Decision**: Remove `withTokens()`, the `T` generic, `#tokens` field, `ThemeBuilderInput` type, and `tokens` from `serialize()`.

**Rationale**: Module augmentation handles type drilling. Theme construction is a consumer concern. The only reason tokens were in SystemBuilder was to pass them to the plugin via `serialize()` — but the plugin can load them directly from module exports.

### 4. Plugin loads tokens from module exports
**Decision**: Subprocess template adds `const tokens = m.tokens || m.theme;` alongside the existing `ds` lookup. Tokens passed to `evaluateThemeObject()` directly.

**Rationale**: The consumer's system module already exports `tokens` (showcase does `export const tokens = createTheme(...).build()`). No new convention needed — just stop routing through serialize.

### 5. Theming package preserved
**Decision**: Leave theming in the monorepo, unchanged.

**Rationale**: Legacy Emotion path may still be needed. Deleting is a separate decision.

## Risks / Trade-offs

**[Risk] Plugin subprocess assumes `tokens` export exists** → If missing, `evaluateThemeObject` receives undefined and variable CSS is empty. Plugin should warn: "No tokens export found — CSS variables will not be generated." Same severity as current behavior when serialize returns empty tokens.

**[Risk] Showcase or other packages import from `@animus-ui/theming` directly** → Verified: showcase's `ds.ts` line 23 imports `createTheme` from `@animus-ui/theming`. Must update to `@animus-ui/system`.

**[Risk] Stale CLAUDE.md / spec references to withTokens** → Update showcase CLAUDE.md, system-builder spec. Grep for `withTokens` across repo to catch all references.
