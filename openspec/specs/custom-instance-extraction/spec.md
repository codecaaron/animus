## Purpose

Requirements for the `custom-instance-extraction` capability: Custom instance extraction via explicit config.

## Requirements

### Requirement: Custom instance extraction via explicit config

Custom design system instances SHALL be configured via the `system` plugin option, replacing `configPath`. The system instance's `.serialize()` provides all extraction config including custom groups and transforms.

#### Scenario: Custom instance with custom groups extracts correctly

- **WHEN** a system instance defines custom groups (`surface`, `arrange`, etc.) and the plugin is configured with `system: './src/ds.ts'`
- **THEN** the extraction pipeline SHALL receive the custom group registry and extract components using those groups

#### Scenario: Transforms resolve for custom instance

- **WHEN** a custom system instance includes custom transforms (e.g., `elevation`, `fluid`) in its prop definitions
- **THEN** `.serialize().transforms` SHALL include those transforms and the plugin SHALL resolve their placeholders
