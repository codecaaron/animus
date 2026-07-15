# release-workflow

## ADDED Requirements

### Requirement: Release gate composition

The CI release job SHALL NOT execute unless all of the following jobs succeeded in the same workflow run: lint, Rust dependency hygiene, the verify job, the Next consumer lane (`verify:next`), the Vite consumer lane (`verify:vite`), and the packed consumer lane (`verify:packed`).

#### Scenario: A gating job fails on a release tag

- **WHEN** a release tag is pushed and any job in the gating set fails
- **THEN** the release job does not run and nothing is published

#### Scenario: Full gate green on a release tag

- **WHEN** a release tag is pushed and every job in the gating set succeeds
- **THEN** the release job proceeds to publish

### Requirement: Consumer lanes run on every CI run

The Next, Vite, and packed consumer lanes SHALL run as unconditional CI jobs in every workflow run — branch pushes that trigger CI, pull requests, release tags, and manual dispatches — not only on release tags.

#### Scenario: CI workflow triggered

- **WHEN** any event in the workflow's trigger set starts a CI run
- **THEN** the `verify:next`, `verify:vite`, and `verify:packed` jobs are scheduled alongside the existing verify job, with no tag-only or branch-only condition on the jobs themselves
