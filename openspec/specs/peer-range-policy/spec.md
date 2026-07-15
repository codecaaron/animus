## Purpose

Defines requirements for the `peer-range-policy` capability.

## Requirements

### Requirement: Evidence-backed peer ranges

Every major version admitted by a published package's host-framework peer range SHALL be exercised by a blocking fixture in this repository, and host-framework peer ranges SHALL declare an explicit upper bound. A host framework is any peer package whose build pipeline the plugin integrates with — the application framework and the bundler it plugs into (for the current plugins: `vite`, `next`, and `webpack`).

#### Scenario: Peer range compared against fixture evidence

- **WHEN** a publishable plugin's peer range for a host framework is compared against the host versions installed by blocking fixtures
- **THEN** every major admitted by the range appears in at least one blocking fixture's resolved dependencies

#### Scenario: Open-ended host peer range

- **WHEN** a publishable plugin declares a host-framework peer range with no upper bound
- **THEN** the range is a policy violation and SHALL be rejected in review

### Requirement: Vite host peer range

The Vite plugin SHALL declare a `vite` peer range of `>=8 <9`.

#### Scenario: Consumer on a proven Vite major

- **WHEN** a consumer installs the Vite plugin alongside Vite 8
- **THEN** peer resolution succeeds without warnings attributable to the `vite` range

#### Scenario: Consumer on an unproven Vite major

- **WHEN** a consumer installs the Vite plugin alongside Vite 7 or Vite 9 using a peer-enforcing package manager
- **THEN** the install reports a peer-range conflict for `vite` (peer enforcement varies by package manager; the packed consumer lane's npm install is the reference enforcer)

### Requirement: Next host peer range

The Next plugin SHALL declare a `next` peer range of `>=15 <16` and a `webpack` peer range of `>=5 <6`; Next 16 SHALL remain excluded until a blocking fixture exercises the exact Next 16 build mode the plugin supports.

#### Scenario: Consumer on a proven Next major

- **WHEN** a consumer installs the Next plugin alongside Next 15
- **THEN** peer resolution succeeds without warnings attributable to the `next` range

#### Scenario: Consumer on an unproven Next major

- **WHEN** a consumer installs the Next plugin alongside Next 14 or Next 16 using a peer-enforcing package manager
- **THEN** the install reports a peer-range conflict for `next` (the packed consumer lane's npm install is the reference enforcer)

#### Scenario: Consumer on an unproven webpack major

- **WHEN** a consumer installs the Next plugin alongside a webpack major other than 5 using a peer-enforcing package manager
- **THEN** the install reports a peer-range conflict for `webpack`
