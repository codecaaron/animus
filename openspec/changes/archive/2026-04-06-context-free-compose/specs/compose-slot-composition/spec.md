## MODIFIED Requirements

### Requirement: Shared variant propagation via CSS cascade
Root SHALL apply shared variant values as CSS classes on itself. Child slots that have matching variant keys SHALL receive inherited styles via CSS descendant selectors. Direct variant props on child slots SHALL override inherited styles via CSS source ordering within the same layer.

#### Scenario: Shared variant flows from Root to child
- **WHEN** `<Family.Root size="sm">` renders with a shared `size` key
- **THEN** Root SHALL apply its variant class (`.Root--size-sm`) and the CSS inheritance rule SHALL style `<Family.Child />` (which has a `size` variant) without any React context or prop passing

#### Scenario: Direct prop overrides inherited
- **WHEN** `<Family.Root size="sm">` renders and `<Family.Child size="lg" />` has a direct prop
- **THEN** Child SHALL apply its own variant class (`.Child--size-lg`) and the CSS override rule SHALL win via source order — child uses `size="lg"` styles

#### Scenario: No props leak to children
- **WHEN** Root provides `size` via its variant class but a child slot does NOT have a `size` variant
- **THEN** the child SHALL NOT be affected — no composed CSS rules are emitted for variants the child does not have

#### Scenario: No React context or useContext in shared variant path
- **WHEN** a composed family renders with shared variants
- **THEN** no `createContext`, `Provider`, or `useContext` SHALL be used for shared variant propagation — the mechanism is purely CSS

#### Scenario: options.shared is read by extraction, not runtime
- **WHEN** `compose()` is called with `{ shared: { size: true } }`
- **THEN** the runtime SHALL NOT consume the `shared` config — it is read by the Rust extraction pipeline at build time to emit composed variant CSS rules. The parameter MUST be preserved in the API signature for extraction compatibility.

## REMOVED Requirements

### Requirement: Shared variant propagation via React context
**Reason**: Replaced by CSS cascade propagation. React context added unnecessary tree depth and runtime overhead, and interfered with third-party headless primitive interop (Ark, Radix).
**Migration**: No API migration needed — compose() call signature is unchanged. Runtime behavior is equivalent: shared variants flow from Root to children, direct props override. The mechanism changes from React context to CSS cascade.
