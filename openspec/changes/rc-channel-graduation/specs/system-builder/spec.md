## ADDED Requirements

### Requirement: createSystem accepts includes via constructor args
The `createSystem()` factory SHALL accept an optional configuration object with an `includes` field: `createSystem({ includes?: readonly SystemInstance[] })`. This relocates the multi-system composition marker from a builder chain method to a constructor argument, establishing the declarative "systems I build on top of" identity at construction time.

The runtime behavior of the `includes` field remains a no-op — the value is retained on the builder for introspection but does not merge prop, group, or selector registries. The load-bearing semantic is at compile time: the extraction pipeline's `discover-packages.ts` parser reads the constructor-argument AST pattern to discover external DS packages (see `includes-driven-discovery` capability).

#### Scenario: Constructor accepts no arguments
- **WHEN** a consumer calls `createSystem()`
- **THEN** the builder SHALL behave identically to the no-argument form — no includes are registered

#### Scenario: Constructor accepts empty includes
- **WHEN** a consumer calls `createSystem({ includes: [] })`
- **THEN** the builder SHALL be equivalent to `createSystem()` — no external packages discovered

#### Scenario: Constructor accepts includes array with SystemInstance values
- **WHEN** a consumer calls `createSystem({ includes: [sysA, sysB] })` where `sysA` and `sysB` are `SystemInstance` values imported from external packages
- **THEN** the builder SHALL accept the argument without runtime error
- **AND** the plugin's `discover-packages.ts` SHALL observe the constructor-argument pattern and resolve `sysA` and `sysB` back to their import specifiers

#### Scenario: includes parameter is type-checked
- **WHEN** a consumer passes a value that does not conform to `readonly SystemInstance[]` (e.g., a plain object)
- **THEN** a TypeScript compile error SHALL be produced at the callsite

### Requirement: SystemBuilder no longer exposes includes() chain method
The builder instance returned by `createSystem()` SHALL NOT expose a public `includes()` chain method. Multi-system composition intent is expressed exclusively via the constructor argument described above.

#### Scenario: No includes method on builder
- **WHEN** a consumer has a `builder = createSystem()` reference
- **THEN** `builder.includes` SHALL be undefined at runtime
- **AND** the TypeScript type of `builder` SHALL NOT include an `includes` method in its public surface

#### Scenario: Existing callsites migrate
- **WHEN** a consumer has prior code calling `createSystem().addProps(...).includes([sys1]).build()`
- **THEN** migration requires moving the argument to constructor form: `createSystem({ includes: [sys1] }).addProps(...).build()`
- **AND** the migration SHALL have no runtime-behavior delta — the chain-method form's runtime was already a no-op
- **AND** the extraction-pipeline semantic SHALL be preserved because `discover-packages.ts` parses the new constructor-argument pattern

### Requirement: Keyframes collection factory exported from system package
The `@animus-ui/system` package SHALL export a top-level `keyframes()` factory function. The factory accepts a record of named frame maps (`Record<Name, KeyframeFrameMap>`) and returns a branded **collection object** exposing one branded `KeyframeRef<Name>` per named keyframe, suitable for use as an `animationName` value in component styles or via template-literal coercion in `animation` shorthand. The collection is discoverable by the plugin via its `__brand === 'Keyframes'` tag.

#### Scenario: keyframes export
- **WHEN** a consumer writes `import { keyframes } from '@animus-ui/system'`
- **THEN** the named export `keyframes` SHALL be available as a callable factory

#### Scenario: keyframes returns a branded collection
- **WHEN** a consumer calls `keyframes({ ember: {...}, flow: {...} })`
- **THEN** the return value SHALL be an object with `__brand === 'Keyframes'` and a `__frames` field carrying the raw record
- **AND** each named key (`ember`, `flow`) SHALL be exposed as a property whose value is a branded `KeyframeRef` (`__brand === 'KeyframeRef'`) preserving the literal name via `__name`
- **AND** each `KeyframeRef` SHALL coerce to a string (via `toString()` / `valueOf()`) yielding the resolved keyframe name for runtime-fallback paths

#### Scenario: Literal-type preservation per key
- **WHEN** a consumer destructures or accesses a named key on the collection (e.g., `const ref = motion.ember`)
- **THEN** TypeScript SHALL infer `ref` as `KeyframeRef<'ember'>` — the literal name SHALL be preserved at the type level so that `animationName: ref` produces precise type errors on typos
