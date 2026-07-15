## Purpose

Defines requirements for the `react-router-extraction-canary` capability.

## Requirements

### Requirement: React Router SSR Worker

The React Router v8 canary SHALL build route modules into a Cloudflare Worker that server-renders its document response.

#### Scenario: Request an SSR route

- **WHEN** an HTTP client requests the canary's primary route from the built Worker
- **THEN** the response is successful and its initial HTML contains the React Router fixture marker

### Requirement: React Router extraction output

The React Router canary SHALL emit static Animus CSS containing theme variables, generated component class selectors, ordered Animus layers, and no unresolved transform placeholders.

#### Scenario: Assert React Router production output

- **WHEN** the focused React Router assertion tier inspects the production output
- **THEN** it finds the expected Animus CSS structures and no unresolved placeholders or runtime Emotion imports

### Requirement: React Router hydration

The React Router canary SHALL hydrate an interactive component over its server-rendered document.

#### Scenario: Exercise hydrated state

- **WHEN** a browser loads the primary route and activates its state-changing control
- **THEN** the visible state marker changes without a full document navigation

### Requirement: React Router Worker dry run

The React Router canary SHALL produce Worker metadata accepted by a credential-free deployment dry run.

#### Scenario: Validate deployment output

- **WHEN** the focused React Router deployment dry run follows a successful build
- **THEN** it exits successfully and identifies `animus-react-router-canary` as the target
