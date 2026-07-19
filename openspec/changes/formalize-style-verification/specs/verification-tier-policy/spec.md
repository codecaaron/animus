## ADDED Requirements

### Requirement: Style-verification harness tier registration

Every agent-facing harness command SHALL be invocable through the repository verification interface as a named tier, and the Change-Type Map SHALL contain rows routing the harness's edit surfaces to their claims in the same change that introduces each surface.

#### Scenario: Harness command lands

- **WHEN** a harness query command becomes available
- **THEN** it is dispatchable via the verification interface's task runner and appears in the contributor-facing tier documentation

#### Scenario: New harness edit surface

- **WHEN** a change introduces a new harness package or edit surface
- **THEN** that change adds the corresponding Change-Type Map row
