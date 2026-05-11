## ADDED Requirements

### Requirement: Dev server reference stored via configureServer
The plugin SHALL implement a `configureServer` hook that stores the Vite dev server reference in the plugin closure. This reference SHALL be available to other hooks (`transform`, `handleHotUpdate`) for programmatic module invalidation and HMR updates.

#### Scenario: Server reference available during transform
- **WHEN** the dev server is running and a `transform` call needs to invalidate a virtual module
- **THEN** the stored server reference SHALL be available for calling `server.moduleGraph.invalidateModule()` and `server.hot.send()`

#### Scenario: Server reference not set in production
- **WHEN** the plugin runs during a production build (`vite build`)
- **THEN** no `configureServer` hook fires and the server reference SHALL remain `undefined`
- **AND** transform SHALL not attempt CSS invalidation
