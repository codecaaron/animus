## Context

`createSystem()` currently uses a nested builder pattern: `SystemBuilder` delegates property registration to `PropertyBuilder` via a callback in `.withProperties()`. This creates two chains, two `.build()` calls, and an inner class (`PropertyBuilder`, 37 lines) that exists solely to accumulate prop groups before returning `{ propRegistry, groupRegistry }`.

The component chain method `.groups()` doesn't match its cascade layer name `@layer system`. Props like `gap` naturally belong in both `flex` and `grid` groups but the current architecture makes this awkward — JS object spread resolves duplicates by last-write-wins, which works accidentally but isn't structurally sound.

This is the last API cleanup before v0.10 finalization.

## Goals / Non-Goals

**Goals:**
- Single builder chain: `createSystem().addGroup(...).addGroup(...).addProps({...}).build()`
- Delete `PropertyBuilder` class entirely
- Rename `.groups()` to `.system()` on component chain (match `@layer system`)
- Support props in multiple groups via overlap tolerance
- Support ungrouped props via `.addProps()`
- Mixed namespace in `.system()`: both group names and individual prop names
- Type-level enforcement that group names don't collide with prop names

**Non-Goals:**
- Renaming `createSystem` factory (separate future concern)
- Scale rebinding / preset distribution (separate future concern)
- Changing `serialize()` placement (handled by `separate-global-styles`)
- Changing the cascade layer order or adding new layers

## Decisions

### 1. `.addGroup()` and `.addProps()` directly on SystemBuilder

**Choice:** SystemBuilder absorbs both methods. `.addGroup(name, config)` registers props AND assigns them to a named group. `.addProps(config)` registers props without grouping.

**Why:** Eliminates the PropertyBuilder class and the callback wrapper. The builder accumulates `PropReg` and `GroupReg` generics directly, returning `new SystemBuilder<NextPropReg, NextGroupReg>` from each call (same `#checkpoint` pattern as ThemeBuilder).

**Alternative considered:** Separate registration from grouping (`.register()` for all props, `.addGroup()` for just naming subsets). Rejected because it doubles the API surface and forces consumers to express the same information twice. The current pattern of "addGroup does both" is ergonomic — we just need to add overlap tolerance.

### 2. Overlap tolerance via definition equality

**Choice:** When a prop key appears in a subsequent `.addGroup()` call with an identical definition, it's added to the new group without error. If definitions differ, it's a type error.

**Why:** Pre-built groups (`flex`, `grid`, `layout`) intentionally share props like `gap`, `alignItems`, `justifyContent`. The consumer writes `.addGroup('flex', { ...flex }).addGroup('grid', { ...grid })` and both groups naturally contain `gap`. Since the definitions come from the same source objects, they're structurally identical.

**Type-level enforcement:** At the TypeScript level, this is enforced by extending the prop registry additively. If a key already exists in `PropReg`, the new definition must be assignable to the existing one. The generic constraint on `addGroup` checks `Conf[K] extends PropReg[K]` for overlapping keys.

**Runtime behavior:** The prop registry stores one definition per key. The group registry maps group names to arrays of keys. A key appearing in multiple groups is just multiple array entries pointing to the same prop definition.

### 3. `.system()` replaces `.groups()` with mixed namespace

**Choice:** The component chain method is renamed from `.groups()` to `.system()`. It accepts an array of identifiers that can be either group names or individual prop names.

**Resolution order:** When the consumer writes `.system(['surface', 'ratio'])`:
1. Check if the identifier is a group name → activate all props in that group
2. Check if the identifier is a prop name → activate just that prop
3. Neither → type error (identifier doesn't exist in the system)

**Type-level:** The accepted values are `keyof GroupReg | keyof PropReg`. The collision constraint (group names ≠ prop names) ensures each identifier resolves unambiguously.

**Why "system":** It matches the cascade layer name `@layer system`. The chain methods already map to layers: `.styles()` → base, `.variant()` → variants, `.compound()` → compounds, `.states()` → states, `.system()` → system, `.props()` → custom. This naming makes the cascade readable in the chain.

### 4. Collision constraint: group names ∩ prop names = ∅

**Choice:** The `addGroup` method's generic constraints prevent naming a group with the same key as any registered prop.

**Implementation:** `addGroup<Name extends string>` constrains `Name extends Exclude<string, keyof PropReg>`. If you try `.addGroup('bg', {...})` and `bg` is already a registered prop, TypeScript errors.

**Why:** Without this constraint, `.system(['bg'])` is ambiguous — does it mean "the group named bg" or "the individual prop bg"? Disjoint namespaces prevent this.

**Practical risk:** Low. Group names tend to be abstract categories (`surface`, `text`, `arrange`) while prop names tend to be CSS-ish (`bg`, `color`, `fontSize`). Natural naming conventions prevent collision. The type constraint is cheap insurance.

### 5. Rust crate updates

**Choice:** Update `chain_walker.rs` to recognize `"system"` instead of `"groups"` as a chain method name. Update `lib.rs` to process `"system"` stage arguments identically to current `"groups"` processing.

**Why:** The Rust crate parses the chain method names from source code. The rename must be reflected there or extraction silently skips the stage.

**Scope:** The change is purely a string rename in the method detection list and the stage processing match arm. The group resolution logic (parsing `{ space: true, layout: true }` arguments) remains identical — the argument structure doesn't change, only which prop names get activated needs to support individual props appearing without a group wrapper.

## Risks / Trade-offs

- **Breaking change across the entire consumer surface:** Every `.groups()` call becomes `.system()`. Every `createSystem().withProperties(...)` becomes `createSystem().addGroup(...)`. Mitigated by: showcase is the only known consumer, and this is pre-v0.10.
- **Overlap detection at runtime vs type level:** Structural equality of `Prop` objects is hard to check at the type level (TS doesn't have deep equality constraints). Runtime check (shallow comparison of property/scale/transform/negative) catches mismatches. Type-level check is best-effort via `extends`.
- **Rust crate string rename:** If any Rust test fixtures use `.groups()`, they need updating. Search-and-replace, but must be thorough.
- **Mixed namespace type complexity:** `keyof GroupReg | keyof PropReg` in `.system()` could produce large union types. In practice, systems have ~6 groups and ~60 props — this is manageable for TypeScript.

## Open Questions

- **Factory naming:** `createSystem()` collides with `.system()` on the component chain. The consumer can destructure to any name, but the collision is conceptually awkward. Defer to a separate naming change?
- **Pre-built group distribution:** The pre-built groups in `@animus-ui/system/groups` have hardcoded scale bindings (`scale: 'colors'`, `scale: 'space'`). A future `system-prop-presets` change could add rebinding/scoping. Not in scope here.
