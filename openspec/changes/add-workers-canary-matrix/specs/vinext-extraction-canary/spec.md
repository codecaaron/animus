## ADDED Requirements

### Requirement: Vinext consumer build

The Vinext canary SHALL build a Next-compatible application containing an App Router server component, an App Router client boundary, and a Pages Router route into Cloudflare Worker output.

#### Scenario: Build the Vinext canary

- **WHEN** the focused Vinext build tier runs
- **THEN** it exits successfully and emits server, client, and Worker deployment artifacts

#### Scenario: Render both router families

- **WHEN** an HTTP client requests the App Router home route, the client route, and the Pages Router legacy route from the built Worker
- **THEN** each route responds successfully with its fixture marker

### Requirement: Vinext extraction output

The Vinext canary SHALL emit static Animus CSS containing theme variables, generated component class selectors, ordered Animus layers, and resolved keyframes with no unresolved transform placeholders.

#### Scenario: Assert Vinext production output

- **WHEN** the focused Vinext assertion tier inspects the production output
- **THEN** it finds the expected Animus CSS structures and no unresolved placeholders or runtime Emotion imports

### Requirement: Vinext client hydration

The Vinext canary SHALL preserve an interactive client component whose visible state changes after a user action.

#### Scenario: Exercise the client boundary

- **WHEN** a browser loads the client route and activates its state-changing control
- **THEN** the visible variant marker changes without a full document navigation

### Requirement: Native Next canary remains valid

Adding Vinext SHALL NOT prevent the existing native Next build and structural assertions from passing.

#### Scenario: Run both Next-family canaries

- **WHEN** the native Next and Vinext focused verification commands run on the same installed workspace
- **THEN** both complete successfully and report their framework-specific output assertions
