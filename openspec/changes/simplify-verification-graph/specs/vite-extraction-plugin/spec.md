## MODIFIED Requirements

### Requirement: File-discovery walk includes `.mdx` sources by default

The Vite extraction plugin's default discovery walk SHALL include `.mdx` sources and preserve the existing extension override behavior. The showcase package-owned production verification claim SHALL remain the end-to-end proof that MDX-rendered design-system components extract correctly.

#### Scenario: `.mdx` files appear in the scanner's input set (default config)

- **WHEN** discovery runs with default extensions
- **THEN** `.mdx` source files are included

#### Scenario: Consumer opt-out via `extensions` override

- **WHEN** a consumer supplies an extension list without `.mdx`
- **THEN** `.mdx` files are excluded

#### Scenario: Pre-processing failure does not halt the build

- **WHEN** an individual MDX source cannot be pre-processed
- **THEN** the existing failure policy remains in effect

#### Scenario: MDX-rendered component extracts in production builds

- **WHEN** `vp run @animus-ui/showcase#verify` builds MDX that renders design-system components
- **THEN** the output assertion observes their extracted CSS

#### Scenario: Adapter-parity via shared constant

- **WHEN** Vite and Next discovery adapters initialize
- **THEN** both consume the shared default extension constant
