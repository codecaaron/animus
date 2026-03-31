## Context

The `ThemeBuilder` chain accumulates theme state across `addColors`, `addColorModes`, `addScale`, `addContextualVars`, and `updateScale` calls. At `.build()`, it resolves token refs, emits CSS variables, and attaches non-enumerable `manifest` and `serialize()` properties to the finished theme object.

What the builder does NOT currently preserve is the **raw input shape**: the nested color config passed to `addColors`, the per-mode alias map passed to `addColorModes`, the per-scale values passed to `addScale`. Only flattened/resolved forms end up in the theme (`_tokens.colors` is flat, `_tokens.modes` holds resolved values, not the alias maps).

The DS library → consumer app use case needs access to these raw inputs so a consumer can:
1. Call `libTokens.unpack()` to get the typed pieces
2. Spread them selectively into their own `createTheme()` chain
3. Add, replace, or omit pieces without manually reproducing token values

## Goals / Non-Goals

**Goals:**
- Expose a typed `unpack()` method on built theme objects
- Return raw config objects that are directly spreaddable into `createTheme()` builder methods
- Preserve the exact TypeScript shape so spread + extension infers correctly
- Match the non-enumerable attachment pattern used by `manifest` and `serialize()`
- Add `UnpackedTheme<T>` type and export it from the system index

**Non-Goals:**
- Modifying extraction, serialization, or the plugin pipeline — `unpack()` is pure DX
- Supporting `updateScale` outputs in unpack (updateScale returns a derived state; consumers should re-derive it)
- Deep-merging on the consumer side — spreading is the consumer's responsibility
- Providing CSS variable values — `unpack()` returns token config, not emitted values

## Decisions

### 1. Accumulate raw config in a private `_rawConfig` field on the builder

**Decision:** Add a `#rawConfig` accumulator to `ThemeBuilder` that collects inputs at each `addColors`, `addColorModes`, and `addScale` call. Carry it through `#checkpoint` like `#emittedScales` and `#contextualVars`.

**Why:** The existing `_tokens.*` fields hold derived/processed state (flat tokens, resolved values). Adding a separate raw accumulator keeps raw inputs orthogonal to the pipeline state. It avoids any risk of raw data interfering with token ref resolution or manifest assembly.

**Alternative considered:** Read raw data back out of `_tokens.*` at build time. Rejected because `_tokens.colors` is flat (loses nesting), `_tokens.modes` holds resolved color values not alias maps, and emitting scales mix variable refs with original values.

### 2. Return nested colors (not flat), alias maps for colorModes, values-only for scales

**Decision:**
- `colors` — the original nested config (e.g., `{ gray: { 50: '#fafafa', ... } }`)
- `colorModes` — `{ default: string, modes: Record<string, ModeConfig> }` using the original unflattened alias maps
- `scales` — `Record<name, { values: Record<string, unknown>, emit?: boolean }>` per scale
- `breakpoints` — the original `Record<string, number>` (already stored as-is on `#theme`)
- `contextualVars` — `Record<string, string[]>` (already assembled at build time in `_contextualVars`)

**Why:** These shapes map 1:1 to the corresponding builder method arguments. A consumer can do `addColors({ ...colors, brand: { 500: '#new' } })` or `addScale({ name: 'space', ...scales.space })` without any transformation.

### 3. Store the `initialMode` key alongside raw modes

**Decision:** `#rawConfig.colorModes` stores `{ default: InitialMode, modes: Config }`. The `default` field records the `initialMode` argument passed to `addColorModes`.

**Why:** `initialMode` is a required argument to `addColorModes`. Without it, the consumer cannot rebuild the same mode configuration. The raw modes map alone is insufficient.

### 4. Non-enumerable attachment at build() time

**Decision:** `unpack()` is attached via `Object.defineProperty` with `enumerable: false`, matching the `manifest` and `serialize()` pattern.

**Why:** Keeps the theme JSON-serializable. The `unpack()` method is DX-only — it should not appear in `Object.keys()`, `JSON.stringify()`, or iteration.

### 5. Type: `UnpackedTheme<Colors, Scales, Modes, Breakpoints>`

**Decision:** Define a generic interface that mirrors the builder's type params. The built theme already carries type params from the chain. `unpack()` narrows its return type using those params.

**Why:** This is what makes consumer-side TypeScript work. `const { colors } = lib.unpack()` should give `colors` the exact type passed to `addColors()`, not `Record<string, unknown>`.

## Risks / Trade-offs

- **`updateScale` outputs are not unpacked** — If a library calls `updateScale` to add derived values, those additions are lost after `unpack()` + rebuild. Consumers need to know this. → Mitigation: document it clearly; updateScale is for derived computation, not token definition.
- **Scales added with `emit: false` are still returned** — This is correct behavior; the consumer decides whether to re-emit. The `emit` flag is not stored in `#rawConfig` because the consumer's context may differ. → Mitigation: document that consumers control re-emit via their own `addScale` call.
- **Multiple `addColors` calls merge** — If a library calls `addColors` twice, each call's raw config is merged into `#rawConfig.colors`. The consumer sees the combined shape. This is correct (it matches what the built theme exposes) but worth documenting.

## Open Questions

- Should `contextualVars` be included in `unpack()`? They are phantom-only and may not make sense to re-declare in a consumer theme. Initial decision: include them as optional, let consumers decide. Revisit if this causes confusion.
