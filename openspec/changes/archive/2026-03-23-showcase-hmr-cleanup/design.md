## Context

The showcase app currently mixes two Animus instances and has several issues:
1. `components.tsx` uses default `animus` from `@animus-ui/core`; `custom-vocabulary.tsx` uses a custom `ds` instance
2. The Vite plugin auto-loads config from `@animus-ui/core`'s default instance, so the custom `ds` groups (surface, arrange, etc.) aren't in the group registry passed to Rust
3. `GridArrange`'s `cols` prop doesn't work because the `gridItemRatio` transform isn't resolved for the custom instance's config path
4. The theme doesn't augment core's `Theme` interface, so Scale type resolution falls through to CompatTheme instead of using the showcase's actual theme scales
5. Dev-mode HMR does full page reload, losing React state

## Goals / Non-Goals

**Goals:**
- Single `ds` instance for all showcase components — end-to-end custom design system workflow
- Theme augments core's `Theme` so Scale types resolve against actual theme values
- Vite config passes custom config/groupRegistry to the plugin
- Transform resolution works for custom instance (gridItemRatio, borderShorthand, size)
- CSS-only HMR preserves React state on style changes
- Content-hash caching for fast incremental re-analysis

**Non-Goals:**
- Auto-detection of custom instances (explicit config passing is the correct API)
- Making `getExtractConfig()` a method on the builder result (future work for Theme-first-class)
- Changes to the Rust extraction pipeline (it already handles any root identifier)

## Decisions

### Decision 1: Custom config via `getExtractConfig()` export

The custom-vocabulary module will export a `getExtractConfig()` function that serializes its own prop config and group registry. The vite.config imports this and passes it to `animusExtract()`.

**Why:** Mirrors the existing pattern from `@animus-ui/core`. The plugin already accepts `config` and `groupRegistry` options. No new API surface needed.

**Implementation:** The `createAnimus().addGroup().build()` result is an AnimusConfig. We need to expose `getExtractConfig()` from the custom config instance. The simplest path: the custom-vocabulary builds its config normally and exports a function that serializes it the same way `getExtractConfig()` does in core.

### Decision 2: Theme augmentation via declare module

The showcase's `theme.ts` will add `declare module '@animus-ui/core' { interface Theme extends BaseTheme {} }`. This makes Scale types resolve against the actual theme (space, fontSizes, colors, etc.) instead of CompatTheme.

**Why:** Without augmentation, `fontSize: 24` is rejected by the type system because `24` isn't in CompatTheme's fontSizes array. With augmentation, it resolves against the theme's `fontSizes` object which has `24` as a key.

### Decision 3: All components from `ds`, merge components.tsx into custom-vocabulary

Instead of maintaining two files, merge all components into `custom-vocabulary.tsx` (rename to `components.tsx`) using the `ds` instance. The custom groups (surface, arrange, text, motion, space, positioning) cover all use cases.

**Why:** One file, one instance, one mental model. Eliminates the mixed-instance confusion.

### Decision 4: CSS module invalidation for HMR

Replace `server.ws.send({ type: 'full-reload' })` with:
```ts
const cssModule = server.moduleGraph.getModuleById(RESOLVED_CSS_ID);
if (cssModule) {
  server.moduleGraph.invalidateModule(cssModule);
  return [cssModule]; // Vite sends CSS-only HMR update
}
```

**Why:** Vite's CSS HMR swaps stylesheets without touching React state. The page stays loaded, components keep their state, only styles update.

### Decision 5: Content-hash file cache

A `Map<string, string>` mapping file paths to content hashes. On `handleHotUpdate`, only re-read files whose hash changed. Skip others by reusing the previous file entry.

**Why:** `analyzeProject` takes all file entries. Re-reading unchanged files from disk is wasted I/O. With hashing, only the changed file is re-read. At scale (~1800 files), this matters.

## Risks / Trade-offs

- **[Risk] Custom getExtractConfig() duplicates serialization logic** → Acceptable; it's ~20 lines and the pattern is well-established. Future Theme-first-class work will unify this.
- **[Risk] CSS-only HMR may not trigger for all change types** → Source code changes (not just style changes) may still need full reload. The plugin should fall through to full-reload for non-extractable changes.
- **[Risk] Content-hash assumes file identity by path** → File renames aren't handled incrementally. This is fine; renamed files trigger a full re-analysis on next save.
