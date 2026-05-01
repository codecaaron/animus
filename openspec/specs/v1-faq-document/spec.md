# v1-faq-document Specification

## Purpose

Provide a single FAQ document that positions the Animus project, explains its mental model, addresses common misconceptions with verifiable evidence, catalogs features and limitations honestly, and guides adoption -- all without duplicating the RFC.

## Requirements

### Requirement: FAQ document structure

The FAQ document SHALL be a single Markdown file at `docs/v1-faq.md` containing exactly these sections in order: What Is This, How It Works, Common Misconceptions, Feature Matrix, Known Limitations, Adoption, Proof Points.

#### Scenario: File exists at expected path

- **WHEN** a reviewer or agent explores the repository
- **THEN** `docs/v1-faq.md` SHALL exist and be readable

#### Scenario: All required sections present

- **WHEN** the FAQ document is opened
- **THEN** it SHALL contain H2 headers for each of the 7 required sections

### Requirement: Positioning section brevity

The "What Is This" section SHALL be no more than 3 sentences. It positions the project without pitching it.

#### Scenario: Positioning is concise

- **WHEN** a reader encounters the "What Is This" section
- **THEN** it SHALL contain at most 3 sentences describing what Animus is, what it produces, and what it requires

### Requirement: Mental model section

The "How It Works" section SHALL provide a 5-bullet mental model covering: builder chain → static extraction → cascade layers → zero-runtime output → graceful degradation.

#### Scenario: Mental model covers pipeline

- **WHEN** a reader encounters "How It Works"
- **THEN** it SHALL explain the path from builder definition to CSS output in 5 bullets without referencing implementation files

### Requirement: Common misconceptions with verification

Each entry in the "Common Misconceptions" section SHALL follow the Claim → Truth → Verify triple structure. Every Verify step SHALL reference a stable identifier (function name, export name, or grep pattern) -- never a line number.

#### Scenario: Token ref opacity misconception

- **WHEN** a reviewer looks for how `{colors.x/40}` opacity syntax works
- **THEN** the FAQ SHALL state that token ref opacity is resolved by the Rust extraction crate, NOT by `createTheme.ts`, and provide a verification path to the Rust function

#### Scenario: includes() misconception

- **WHEN** a reviewer encounters `.includes()` on SystemBuilder and notes it is a runtime no-op
- **THEN** the FAQ SHALL explain that `includes()` is a by-design AST marker consumed by `extractSystemFilePackages()` for package discovery, and provide verification

#### Scenario: Module augmentation misconception

- **WHEN** a reviewer flags `declare module '@animus-ui/system'` as unusual
- **THEN** the FAQ SHALL note this is the industry-standard pattern (Emotion, styled-components) for TypeScript theme type augmentation

#### Scenario: Zero-runtime misconception

- **WHEN** a reviewer claims "zero runtime" is misleading
- **THEN** the FAQ SHALL define zero-runtime as "no style computation at render time" and state the runtime size (pure string lookup, no hooks, no browser APIs), with verification path

#### Scenario: Prop groups misconception

- **WHEN** a reviewer assumes prop groups (space, color, typography) are framework-provided defaults
- **THEN** the FAQ SHALL state that all prop groups are 100% user-defined via `.addGroup()` and that the showcase's groups are that application's design choices, not the framework's opinions

### Requirement: Feature matrix format

The "Feature Matrix" section SHALL present features as a table with columns: Feature, Supported (Yes/No), How (brief mechanism).

#### Scenario: Feature matrix covers core capabilities

- **WHEN** the feature matrix is consulted
- **THEN** it SHALL include entries for at minimum: CSS variables, color modes, responsive props, token references, opacity modifiers, custom transforms, cascade layers, global styles, multi-slot composition, framework-agnostic output, Vite support, Next.js support, CSS variable prefixing, incremental HMR

#### Scenario: Feature matrix entries are verifiable

- **WHEN** a feature is listed as "Yes"
- **THEN** the "How" column SHALL name the mechanism (builder method, pipeline step, or plugin feature) that provides it

### Requirement: Known limitations with status

Each entry in "Known Limitations" SHALL include a status tag: `planned`, `designing`, `not-planned`, or `known-constraint`.

#### Scenario: Limitations are honest

- **WHEN** a reviewer checks known limitations
- **THEN** the section SHALL include at minimum: single CSS file (no route splitting), static-only extraction values, compose() requires 'use client' in App Router, no Webpack standalone plugin

#### Scenario: Status tags are accurate

- **WHEN** a limitation is tagged as `planned`
- **THEN** there SHALL exist a corresponding openspec proposal or active change for that feature

### Requirement: Adoption section

The "Adoption" section SHALL cover plugin setup (both Vite and Next.js), the module augmentation pattern, and the answer to "how do I use this" (add plugin, import virtual stylesheet, define components).

#### Scenario: Setup is concrete

- **WHEN** a prospective adopter reads the adoption section
- **THEN** it SHALL show the minimum config for both `animusExtract()` (Vite) and `withAnimus()` (Next.js) with the single required option (`system`)

### Requirement: Proof points index

The "Proof Points" section SHALL provide a consolidated index of all verification paths used throughout the document, grouped by package.

#### Scenario: All verify steps are indexed

- **WHEN** a Claim → Truth → Verify triple appears in the misconceptions section
- **THEN** its Verify path SHALL also appear in the Proof Points index

### Requirement: No RFC duplication

The FAQ SHALL NOT restate content from RFC.md. Where deeper explanation is needed, it SHALL reference the RFC by section (e.g., "See RFC.md $7").

#### Scenario: RFC reference instead of duplication

- **WHEN** an FAQ entry touches on extraction pipeline details, builder chain mechanics, or runtime audit
- **THEN** it SHALL link to the relevant RFC section rather than restating the content
