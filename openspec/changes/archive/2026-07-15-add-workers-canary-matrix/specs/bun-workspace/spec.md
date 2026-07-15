## ADDED Requirements

### Requirement: Worker canary workspace membership

The Bun workspace SHALL include the Vinext and React Router end-to-end applications.

#### Scenario: Install the expanded workspace

- **WHEN** `bun install` runs at the repository root
- **THEN** the lockfile resolves dependencies for `@animus-ui/vinext-app` and `@animus-ui/react-router-app`

### Requirement: Explicit Worker command surface

The root command surface SHALL provide separately named deployment entry points for showcase, Vite, Vinext, and React Router targets and SHALL NOT invoke Netlify.

#### Scenario: Inspect deployment commands

- **WHEN** a maintainer enumerates root deployment scripts
- **THEN** each Worker target has an unambiguous command and no command invokes the Netlify CLI

### Requirement: Framework engine compatibility

The repository toolchain SHALL satisfy the declared Node engine of every installed Worker-canary framework.

#### Scenario: Validate the locked framework graph

- **WHEN** the Worker manifest contract test reads `.tool-versions` and `.node-version` after the recorded React Router and Vinext engine metadata has selected the dependency tuple
- **THEN** both files pin the same current LTS Node version and that version is greater than or equal to every required Node engine floor
