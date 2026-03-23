## Context

Animus currently has three separate packages for design system definition: `@animus-ui/theming` (token scales, color modes), `@animus-ui/core` (builder chain, prop groups, transforms, Emotion runtime), and `@animus-ui/runtime` (extraction shim). The extraction pipeline has made Emotion unnecessary for the component creation path — static CSS replaces runtime style compilation. But `core` still carries Emotion as a dependency, and the type system still routes through global augmentable interfaces (`Theme`, `CompatTheme`, `AbstractTheme`).

The builder chain currently has 3 leading generics (`PropRegistry`, `GroupRegistry`, `BaseParser`) with no theme parameterization. Theme types resolve through a global `Theme` interface augmented via `declare module`, falling back to `CompatTheme` defaults.

### Current generic signatures

```
Animus<PropRegistry, GroupRegistry, BaseParser>
  → AnimusWithBase<PR, GR, BP, BaseStyles>
    → AnimusWithVariants<PR, GR, BP, BS, Variants>
      → AnimusWithStates<PR, GR, BP, BS, V, States>
        → AnimusWithSystem<PR, GR, BP, BS, V, S, ActiveGroups>
          → AnimusWithAll<PR, GR, BP, BS, V, S, AG, CustomProps>

AnimusExtended<PR, GR, BP, BS, V, S, AG, CP> (8 generics, flexible ordering)

ScaleValue<Config extends Prop> — resolves via keyof Theme | keyof CompatTheme | MapScale | ArrayScale
```

## Goals / Non-Goals

**Goals:**
- New `@animus-ui/system` package with zero Emotion dependency
- Concentric builder API: `createSystem().withTokens().withProperties().build()`
- `T extends BaseTheme` as first-class generic on all builder classes
- `ScaleValue<Config, T>` resolves directly from `T` — no fallback chain
- Single `.serialize()` method produces everything the Vite plugin needs
- Showcase migrated to system package as proof of concept

**Non-Goals:**
- Modifying `@animus-ui/core` — it stays as-is for the Emotion path
- Modifying `@animus-ui/theming` — ThemeBuilder is reused, not rewritten
- Changing the Rust extraction crate — it consumes the same serialized config format
- Changing the runtime shim — `createComponent` is unchanged
- Removing Emotion from the monorepo — core still uses it
- Transform registration API — transforms stay on prop definitions

## Decisions

### 1. New package vs core refactor

**Decision:** New `packages/system/` package. Core stays untouched.

**Alternatives considered:**
- Thread T through existing core (the superseded unified-theme-instance approach). Rejected: core carries Emotion, CompatTheme, createStylist, createParser — all legacy. Threading T through legacy code means maintaining backwards compatibility with `declare module` and the CompatTheme fallback chain simultaneously. Higher risk, same outcome.
- Fork core and strip legacy. Rejected: "fork" implies the new package will track changes in core. It won't — the new package has fundamentally different constraints (no Emotion, T-first).

**Rationale:** Clean-room rewrite of the builder chain and type system, reusing prop group definitions and the ThemeBuilder. The builder PATTERN is stable; the TYPE SYSTEM is what changes. A new package lets us build the correct type system without backwards-compatible contortions.

**Risk:** Two builder chain implementations in the monorepo. Mitigated by: core is not being actively developed, only referenced. The system package is the forward path.

### 2. Concentric builder with callback isolation

**Decision:** `createSystem().withTokens(cb).withProperties(cb).build()` where each callback receives a phase-specific builder and returns its built result.

**Alternatives considered:**
- Config object: `createSystem({ tokens, groups })`. Rejected: TypeScript must infer all generics simultaneously. When property types reference token scales (e.g., `scale: 'colors'` → `keyof T['colors']`), circular inference or widening occurs. Sequential method calls provide separate inference boundaries.
- Flat builder: `createSystem().tokens({}).addGroup().build()`. Rejected: leaks phase-specific methods into the same namespace. Token methods (`.breakpoints()`, `.colors()`) shouldn't be callable after property phase.

**Rationale:** Callbacks provide lexical isolation (each phase's methods are scoped), sequential inference (T resolved before GroupRegistry), and composability (callbacks can be extracted to separate files). The pattern mirrors the design system's conceptual dependency: tokens → properties → components.

### 3. T as first generic parameter on all builder classes

**Decision:** Add `T extends BaseTheme` as the FIRST generic on all 6 Animus classes and AnimusExtended (8 sub-classes). New signatures:

```
Animus<T, PropRegistry, GroupRegistry, BaseParser>
  → AnimusWithBase<T, PR, GR, BP, BaseStyles>
    → AnimusWithVariants<T, PR, GR, BP, BS, Variants>
      → AnimusWithStates<T, PR, GR, BP, BS, V, States>
        → AnimusWithSystem<T, PR, GR, BP, BS, V, S, ActiveGroups>
          → AnimusWithAll<T, PR, GR, BP, BS, V, S, AG, CustomProps>

AnimusExtended<T, PR, GR, BP, BS, V, S, AG, CP> (9 generics)
```

**Rationale:** T must be first because it's the most stable — set once in `.withTokens()` and never changes. All other generics narrow through the chain. First position means it's always the same across all class instantiations.

**Risk:** TypeScript instantiation depth. 9 generics on AnimusExtended means 9 levels of generic nesting at each type resolution. Mitigated by: spike test with showcase's complex theme before full implementation.

### 4. ScaleValue resolves directly from T

**Decision:** Replace the multi-fallback chain:
```typescript
// Before (4 branches):
type ScaleValue<Config> =
  Config['scale'] extends keyof Theme ? keyof Theme[Config['scale']] | ...
  : Config['scale'] extends MapScale ? keyof Config['scale'] | ...
  : Config['scale'] extends ArrayScale ? Config['scale'][number] | ...
  : Config['scale'] extends keyof CompatTheme ? CompatValue<...> | ...
  : PropertyValues<Config, true>

// After (2 branches):
type ScaleValue<Config, T extends BaseTheme> =
  Config['scale'] extends keyof T ? keyof T[Config['scale']] | PropertyValues<Config>
  : Config['scale'] extends MapScale | ArrayScale ? ScaleKeys<Config['scale']> | PropertyValues<Config>
  : PropertyValues<Config>
```

**Rationale:** No CompatTheme fallback. No global Theme reference. T IS the theme. If T has a `colors` scale, `keyof T['colors']` provides autocomplete. If T doesn't have a scale the prop references, it falls through to raw CSS values. This is simpler, faster to compile, and produces better error messages.

### 5. Prop groups as source of truth in system package

**Decision:** Copy the 13 prop group objects into `packages/system/src/groups/`. Export from `@animus-ui/system/groups`.

**Alternatives considered:**
- Import from core: creates dependency on the legacy package.
- Shared `@animus-ui/props` package: over-engineering for data that rarely changes.

**Rationale:** Prop groups are pure data objects — no logic, no Emotion dependency. Copying ~200 lines of prop definitions is cheaper than maintaining a shared package. If core needs updates (it won't — it's frozen), the system package is the forward path.

### 6. SystemInstance exposes builder chain directly

**Decision:** `ds.styles()` works directly — no `ds.builder.styles()` indirection. System-level methods (`.serialize()`, `.tokens`) coexist on the same object.

```typescript
interface SystemInstance<T, PropReg, GroupReg> {
  // Component creation (builder chain entry)
  styles<Props>(config: CSSProps<Props, SystemProps<...>, T>): AnimusWithBase<T, ...>

  // Plugin-facing
  serialize(): { tokens: T; propConfig: PropReg; groupRegistry: GroupReg; transforms: TransformRegistry }
  tokens: T

  // Extension
  // Inherited from Animus: variant(), states(), groups(), props(), asElement(), etc.
}
```

**Rationale:** The primary use case is `ds.styles({...})` — component creation should be zero-friction. Plugin serialization is called once at build time. Mixing the two is acceptable because they serve different audiences (developer vs plugin) at different times (dev-time vs build-time).

### 7. Plugin loads system via single subprocess

**Decision:** Replace `loadConfig()` + `loadTheme()` + `resolveTransforms()` with one `loadSystem()` call that imports the system module and calls `.serialize()`.

```typescript
// Plugin subprocess:
const { ds } = await import(systemPath);
const config = ds.serialize();
// → { tokens, propConfig, groupRegistry, transforms }
```

Transform registry built in-process from the serialized config. No separate `resolve-transforms.ts` subprocess.

**Rationale:** The system instance IS the single source of truth. One import, one serialization call, one subprocess. Transforms come along because they're on prop definitions — `.serialize()` walks the groups and extracts them.

### 8. ThemeBuilder reused inside .withTokens()

**Decision:** The `.withTokens()` callback receives a fresh ThemeBuilder instance. The callback chains ThemeBuilder methods and returns `.build()`.

```typescript
.withTokens(t => t
  .breakpoints({...})
  .colors({...})
  .colorModes('light', {...})
  .build()
)
```

**Alternatives considered:**
- New token builder. Rejected: ThemeBuilder already does exactly this. Rewriting it duplicates work.
- Accept a pre-built theme object. Partially accepted: if someone has an existing theme, `.withTokens(() => existingTheme)` works. But the callback pattern is primary for fresh definitions.

**Rationale:** ThemeBuilder is stable, tested, and does exactly what we need. The only change: the system package imports from `@animus-ui/theming` (or copies the ThemeBuilder). The callback just provides a convenient entry point.

## Risks / Trade-offs

**[TypeScript instantiation depth]** → Spike test with showcase theme before full implementation. If depth is hit, investigate type-level simplification (fewer conditional types, collapsed utility types). Worst case: reduce AnimusExtended generics by combining related types.

**[Two builder chains in monorepo]** → Core is frozen, not actively developed. System is the forward path. Document this clearly. Delete core when no packages depend on it.

**[ThemeBuilder dependency]** → System imports from theming package. If theming needs changes, they must be backwards-compatible. Alternatively: copy ThemeBuilder into system (breaks the dependency, allows independent evolution).

**[Prop group drift]** → Groups copied into system could diverge from core. Mitigated: core is frozen. System groups are the source of truth going forward.

**[lodash.merge in AnimusExtended]** → Currently used for variant/state merging. The system package should not carry lodash. Replace with a focused deep-merge utility (~20 lines) or use structuredClone + Object.assign.
