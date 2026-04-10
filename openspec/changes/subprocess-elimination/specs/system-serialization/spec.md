## MODIFIED Requirements

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
