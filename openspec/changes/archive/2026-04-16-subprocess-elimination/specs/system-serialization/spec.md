## SUPERSEDED

> **The subprocess described here was fully eliminated by rust-system-loader (session 67).** System loading now uses NAPI `loadSystemModule()` with OXC type-stripping + rquickjs evaluation — no subprocess at all. The modifications below describe the intermediate plan to reduce subprocess output; the final implementation went further and removed the subprocess entirely. See `rust-system-loader` main spec.

## MODIFIED Requirements (as originally proposed — subprocess fully eliminated by rust-system-loader)

### Requirement: System module export detection
The system load subprocess SHALL detect SystemInstance by interface (`.toConfig()` method presence), not name convention. It SHALL continue to discover global style blocks from named exports via `__brand === 'GlobalStyleBlock'`. However, it SHALL output the raw `styles` object of each global style block (not resolved CSS). Transform names SHALL no longer be extracted by the subprocess — Rust discovers them from source files via AST scanning.

#### Scenario: Subprocess outputs raw global style blocks
- **WHEN** the system module exports `globalStyles` with `__brand: 'GlobalStyleBlock'`
- **THEN** subprocess output JSON includes `globalStyleBlocks: { globalStyles: { /* raw styles object */ } }`

#### Scenario: Subprocess omits transform names
- **WHEN** the system module has transforms registered via `.toConfig().transforms`
- **THEN** subprocess output JSON does NOT include `transformNames` — Rust extracts transform metadata from source files instead

#### Scenario: Subprocess output shape
- **WHEN** subprocess runs successfully
- **THEN** output JSON contains: `propConfig`, `groupRegistry`, `serialized` (theme), `selectorAliases`, `selectorOrder`, `globalStyleBlocks` (raw). It SHALL NOT contain `transformNames`.
