## 1. System Package — Builder & Serialization

- [ ] 1.1 Add `#selectors` private field and `Selectors` generic parameter to `SystemBuilder` class
- [ ] 1.2 Implement `.withSelectors()` method that stores the map and returns a new builder with updated `Selectors` generic
- [ ] 1.3 Thread `#selectors` through constructor, `.withTokens()`, `.withProperties()`, `.withGlobalStyles()` (preserve across builder chain)
- [ ] 1.4 Add `selectors` field to `SerializedConfig` interface
- [ ] 1.5 Pass `#selectors` to `serializeInstance()` and include in serialized output
- [ ] 1.6 Update `SystemInstance` type to carry `Selectors` generic parameter
- [ ] 1.7 Add `SelectorKeys<S>` mapped type producing `'&:${keyof S & string}'` union
- [ ] 1.8 Integrate `SelectorKeys` into `ThemedCSSProps` so registered selectors appear in style object key autocomplete
- [ ] 1.9 Export new types from package index (`SelectorKeys`, updated `SerializedConfig`)

## 2. Rust Crate — Selector Expansion

- [ ] 2.1 Add `selectors: Option<HashMap<String, String>>` to extraction config struct
- [ ] 2.2 Parse selector registry from JSON input in `extract()` and `analyze_project()` NAPI functions
- [ ] 2.3 Implement selector expansion in CSS generator: when emitting a selector key starting with `&:`, check if suffix matches a registered key, replace with `&${value}`
- [ ] 2.4 Apply expansion recursively at every nesting level (not just top-level keys)
- [ ] 2.5 Ensure unregistered `&:name` selectors pass through unchanged (standard CSS pseudo-classes)

## 3. Vite Plugin — Config Forwarding

- [ ] 3.1 Read `selectors` from serialized system config in `loadSystem()`
- [ ] 3.2 Include selector registry in config JSON passed to `analyze_project()` and `extract()` calls
- [ ] 3.3 Ensure selector registry is updated on geological reset (dev mode system reload)

## 4. Type Tests & Verification

- [ ] 4.1 Add type-level tests in `types.test-d.tsx`: autocomplete for registered selector keys in `.styles()` object
- [ ] 4.2 Add canary extraction test: source with `'&:open'` shorthand → CSS output contains `[data-state="open"]`
- [ ] 4.3 Add canary test: unregistered `'&:hover'` passes through as CSS pseudo-class
- [ ] 4.4 Run `bun run verify` — all existing tests + new type tests pass
- [ ] 4.5 Run `bun run verify:showcase` — showcase builds with no regressions

## 5. Showcase Dogfood

- [ ] 5.1 Add `.withSelectors()` call to showcase `ds.ts` with appropriate selectors for the showcase's DOM patterns
- [ ] 5.2 Replace any raw attribute selectors in showcase components with registered shorthands
- [ ] 5.3 Verify showcase builds and renders correctly with selector shorthands
