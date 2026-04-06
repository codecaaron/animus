## ADDED Requirements

### Requirement: compose() accepts optional `context` boolean
`compose()` SHALL accept an optional `context: boolean` field in the options object. When `true`, compose() SHALL create a React context for shared variant prop propagation alongside CSS cascade. When `false` or omitted, compose() SHALL use CSS-only propagation with no React context.

#### Scenario: context option accepted
- **WHEN** `compose({ Root: R, Child: C }, { shared: { size: true }, context: true })` is called
- **THEN** the call SHALL succeed and the resulting family SHALL use React context for shared variant propagation

#### Scenario: context defaults to false
- **WHEN** `compose({ Root: R, Child: C }, { shared: { size: true } })` is called without a `context` option
- **THEN** the resulting family SHALL use CSS-only propagation with no React context — identical to current behavior

#### Scenario: context option in TypeScript
- **WHEN** the `context` option is used in TypeScript
- **THEN** it SHALL be typed as `context?: boolean` with no impact on `SharedConfig`, `ComposedFamily`, or consumer-facing prop types

### Requirement: Context-mode Root provides shared prop values via Provider
When `context: true`, the Root slot wrapper SHALL create a `FamilyContext.Provider` wrapping `props.children` inside Root's rendered output. The Provider value SHALL contain only the shared variant prop values extracted from Root's props.

#### Scenario: Root provides shared values
- **WHEN** `<Family.Root size="lg">` renders in a `context: true` family with `shared: { size: true }`
- **THEN** Root SHALL provide `{ size: "lg" }` via React context to all React children, including portal-mounted children

#### Scenario: Provider wraps children inside Root
- **WHEN** Root renders in context mode
- **THEN** the Provider SHALL be placed INSIDE Root's rendered element wrapping `props.children`, not outside Root — ensuring portaled React children (which are React children even when DOM-escaped) receive the context

### Requirement: Context-mode children merge context with direct props
When `context: true`, non-Root slot wrappers SHALL call `useContext(FamilyContext)` and merge the context values under their direct props. Direct props SHALL override context-provided values.

#### Scenario: Child receives shared value from context
- **WHEN** `<Family.Child />` renders without a direct `size` prop in a `context: true` family where Root provides `size="lg"`
- **THEN** Child SHALL receive `size="lg"` from context and resolve it through its own variant runtime

#### Scenario: Direct prop overrides context value
- **WHEN** `<Family.Child size="sm" />` renders with a direct `size` prop in a `context: true` family where Root provides `size="lg"`
- **THEN** Child SHALL use `size="sm"` (direct prop wins) — context value is ignored for that prop

### Requirement: `"use client"` directive injection
When the extraction pipeline detects `context: true` in a compose call, the transformed output SHALL include a `"use client"` directive at the top of the file if one is not already present.

#### Scenario: Directive injected when absent
- **WHEN** a source file contains `compose({ Root: R, Child: C }, { shared: { size: true }, context: true })` and does NOT start with `'use client'` or `"use client"`
- **THEN** the transformed output SHALL start with `'use client';` followed by a newline, before any import statements

#### Scenario: Existing directive preserved
- **WHEN** a source file already starts with `'use client'` and contains a `context: true` compose call
- **THEN** the existing directive SHALL be preserved as-is — no duplicate directive SHALL be added

#### Scenario: No directive without context
- **WHEN** a source file contains only `context: false` or default compose calls (no `context: true`)
- **THEN** the pipeline SHALL NOT inject a `"use client"` directive (existing directives are still preserved if present)

## MODIFIED Requirements

### Requirement: Shared variant propagation via CSS cascade
Root SHALL apply shared variant values as CSS classes on itself. Child slots that have matching variant keys SHALL receive inherited styles via CSS descendant selectors emitted by the extraction pipeline. Direct variant props on child slots SHALL override inherited styles via CSS source ordering within the same `@layer`. When `context: true` is specified, React context SHALL additionally propagate shared variant prop values to children, providing a fallback for portal-mounted children that CSS descendant selectors cannot reach.

#### Scenario: Shared variant flows from Root to child
- **WHEN** `<Family.Root density="compact">` renders with a shared `density` key
- **THEN** Root SHALL apply its variant class (`.Root--density-compact`) and the CSS inheritance rule SHALL style `<Family.Child />` (which has a `density` variant) without any React context or prop passing

#### Scenario: Direct prop overrides inherited
- **WHEN** `<Family.Root density="compact">` renders and `<Family.Child density="loose" />` has a direct prop
- **THEN** Child SHALL apply its own variant class (`.Child--density-loose`) and the CSS override rule SHALL win via source order — child uses `density="loose"` styles

#### Scenario: No props leak to children
- **WHEN** Root provides `density` via its variant class but a child slot does NOT have a `density` variant
- **THEN** the child SHALL NOT be affected — no composed CSS rules are emitted for variants the child does not have

#### Scenario: No React context in default shared variant path
- **WHEN** a composed family renders with shared variants and `context` is `false` or omitted
- **THEN** no `createContext`, `Provider`, or `useContext` SHALL be used for shared variant propagation — the mechanism is purely CSS

#### Scenario: React context used when context option is true
- **WHEN** a composed family is created with `context: true`
- **THEN** `createContext`, `Provider`, and `useContext` SHALL be used alongside CSS cascade to propagate shared variant prop values to children

#### Scenario: options.shared is read by extraction, not runtime
- **WHEN** `compose()` is called with `{ shared: { density: true } }`
- **THEN** the runtime SHALL NOT consume the `shared` config for CSS class generation — it is read by the Rust extraction pipeline at build time to emit composed variant CSS rules. When `context: true`, the runtime reads `shared` keys to determine which props to propagate via context.
