## MODIFIED Requirements

### Requirement: Custom instance extraction via explicit config

Custom design system instances SHALL be configured via the `system` plugin option, replacing `configPath`. The system instance's `.serialize()` provides all extraction config including custom groups and transforms.

#### Scenario: Custom instance with custom groups extracts correctly

- **WHEN** a system instance defines custom groups (`surface`, `arrange`, etc.) and the plugin is configured with `system: './src/ds.ts'`
- **THEN** the extraction pipeline SHALL receive the custom group registry and extract components using those groups

#### Scenario: Transforms resolve for custom instance

- **WHEN** a custom system instance includes custom transforms (e.g., `elevation`, `fluid`) in its prop definitions
- **THEN** `.serialize().transforms` SHALL include those transforms and the plugin SHALL resolve their placeholders

## REMOVED Requirements

### Requirement: Theme augmentation for custom instance type safety

**Reason:** With T as a first-class generic on the builder chain, scale resolution flows from the system's `.withTokens()` phase. No `declare module` augmentation is needed.
**Migration:** Remove `declare module '@animus-ui/core' { interface Theme extends ... }` from consumer code. Theme types flow automatically from `.withTokens()`.

### Requirement: Custom getExtractConfig export

**Reason:** Replaced by `.serialize()` on the SystemInstance. The system knows how to serialize itself — no standalone utility needed.
**Migration:** Replace `export const getExtractConfig = () => serializeExtractConfig(ds)` with `ds.serialize()` (called by the plugin automatically).
