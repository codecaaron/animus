## SUPERSEDED

> **This capability was proposed but never shipped.** The bin file post-processor was superseded by embedded-transform-eval (session 62): transforms are resolved in-process via boa_engine during Rust `analyzeProject`. No bin file is generated, no execSync call is made. The `__TRANSFORM__` placeholders are resolved within the Rust crate before CSS is returned to the plugin. See `rust-extraction-pipeline` main spec.

## ADDED Requirements (as originally proposed — not implemented)

### Requirement: Plugin generates a zero-dependency transform resolver
After `analyzeProject` produces CSS with `__TRANSFORM__` placeholders, the plugin SHALL write a CJS JavaScript file containing the extracted transform function sources and a regex-based resolver. This file SHALL have zero `require()` or `import` statements (except `fs` from Node stdlib). It SHALL be runnable by both `node` and `bun` without modification.

#### Scenario: Bin file generated with extracted transforms
- **WHEN** the manifest contains extracted transforms `{ size: "(value) => {...}", fluid: "(value) => {...}" }`
- **THEN** the plugin writes a temp CJS file containing both functions and a resolver that reads input CSS, replaces `__TRANSFORM__` placeholders, and writes output CSS

#### Scenario: Bin file runs under Node
- **WHEN** the resolver file is executed via `node resolver.js input.css output.css`
- **THEN** it reads input.css, resolves all `__TRANSFORM__` placeholders, and writes output.css

#### Scenario: Bin file runs under bun
- **WHEN** the resolver file is executed via `bun run resolver.js input.css output.css`
- **THEN** behavior is identical to the Node execution

#### Scenario: No transforms extracted — bin file skipped
- **WHEN** the manifest contains no extracted transforms
- **AND** the CSS contains no `__TRANSFORM__` placeholders
- **THEN** the plugin skips bin file generation and uses the raw CSS directly

### Requirement: Transform resolver handles numeric coercion
The resolver SHALL coerce `__TRANSFORM__` raw values to numbers when the value is a valid numeric string. This matches the current subprocess behavior: transforms receive `Number(rawValue)` when `rawValue` is numeric, and the raw string otherwise.

#### Scenario: Numeric string coerced to number
- **WHEN** CSS contains `__TRANSFORM__size__4__`
- **THEN** the transform function receives `4` (number), not `"4"` (string)

#### Scenario: Non-numeric string passed as string
- **WHEN** CSS contains `__TRANSFORM__gridItem__max__`
- **THEN** the transform function receives `"max"` (string)

#### Scenario: Empty string passed as string
- **WHEN** CSS contains `__TRANSFORM__size____`
- **THEN** the transform function receives `""` (string)

### Requirement: Unresolvable placeholders pass through as raw values
When a `__TRANSFORM__` placeholder references a transform name not present in the extracted transforms (e.g., because it failed validation), the resolver SHALL emit the raw value without the placeholder wrapper.

#### Scenario: Unknown transform name falls through
- **WHEN** CSS contains `__TRANSFORM__unknownFn__4__` and `unknownFn` is not in the bin file
- **THEN** the output CSS contains `4` (the raw value)

### Requirement: Bin file resolution is a single exec call
The plugin SHALL execute the bin file via a single `execSync` call. The bin file SHALL read from an input file path (argv[2]) and write to an output file path (argv[3]). The plugin writes the raw CSS to a temp input file, executes the resolver, and reads the resolved CSS from the output file.

#### Scenario: Resolution via execSync
- **WHEN** `analyzeProject` returns CSS containing `__TRANSFORM__` placeholders
- **THEN** the plugin writes raw CSS to a temp file, executes `{runtime} run {resolverPath} {inputPath} {outputPath}`, and reads the resolved CSS

#### Scenario: Exec failure in strict mode
- **WHEN** the bin file execution fails (e.g., syntax error in extracted transform) and `strict: true`
- **THEN** the build halts with an error describing the failure

#### Scenario: Exec failure in non-strict mode
- **WHEN** the bin file execution fails and `strict: false`
- **THEN** a warning is logged and the raw CSS (with unresolved placeholders) is used as fallback

### Requirement: Bin file cleaned up after resolution
The plugin SHALL delete the generated bin file and temp CSS files after resolution completes (or fails). Cleanup failures SHALL be silently caught.

#### Scenario: Temp files cleaned after successful resolution
- **WHEN** bin file resolution succeeds
- **THEN** the resolver file, input CSS file, and output CSS file are deleted from the temp directory

### Requirement: Bin file resolver handles all CSS in a single pass
The resolver SHALL process the ENTIRE combined CSS (global styles + component styles) in a single regex pass. Global styles that emit `__TRANSFORM__` placeholders SHALL be resolved in the same execution as component style placeholders.

#### Scenario: Global and component transforms resolved together
- **WHEN** CSS contains `__TRANSFORM__size__4__` from a global style and `__TRANSFORM__fluid__16-24__` from a component style
- **THEN** both are resolved in a single bin file execution
