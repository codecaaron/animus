## ADDED Requirements

### Requirement: Vite Worker API and asset routing

The Vite test app SHALL expose a Worker API response while continuing to serve its React SPA and extracted production assets.

#### Scenario: Request the Worker API

- **WHEN** an HTTP client requests the fixture API route from the built Worker
- **THEN** the response is successful and contains the Vite Worker canary marker

#### Scenario: Request an SPA route

- **WHEN** an HTTP client requests a client-side route with no matching asset
- **THEN** the response is successful and contains the Vite application entry document

### Requirement: Vite Worker build preserves extraction assertions

The Vite Worker production build SHALL continue satisfying the existing Vite test app's structural CSS and JavaScript assertions.

#### Scenario: Run focused Vite verification

- **WHEN** the focused Vite build and assertion tiers run after Worker support is enabled
- **THEN** the existing layer, variable, class-name, keyframe, placeholder, and Emotion assertions all pass

### Requirement: Vite Worker deployment dry run

The Vite test app SHALL produce Worker metadata accepted by a credential-free deployment dry run.

#### Scenario: Validate Vite Worker deployment output

- **WHEN** the focused Vite deployment dry run follows a successful build
- **THEN** it exits successfully and identifies `animus-vite-canary` as the target
