import { describe, expect, test } from 'bun:test';

import { canonicalize, classify } from './canonicalize';

const WRAPPERLESS = `### Requirement: Alpha does a thing

The system SHALL alpha.

#### Scenario: Alpha happens

- **WHEN** alpha is requested
- **THEN** alpha SHALL occur
`;

const DELTA_ONLY = `## ADDED Requirements

### Requirement: Beta exists

The system SHALL beta.

#### Scenario: Beta happens

- **WHEN** beta runs
- **THEN** beta SHALL succeed

## MODIFIED Requirements

### Requirement: Beta exists

The system SHALL beta twice.

#### Scenario: Beta happens twice

- **WHEN** beta runs
- **THEN** beta SHALL succeed twice

## REMOVED Requirements

### Requirement: Gamma retired

**Reason**: obsolete
**Migration**: none
`;

const CANONICAL = `## Purpose

Existing purpose.

## Requirements

### Requirement: Delta stands

The system SHALL delta.

#### Scenario: Delta holds

- **WHEN** delta runs
- **THEN** delta SHALL hold
`;

const MIXED =
  CANONICAL +
  '\n## ADDED Requirements\n\n### Requirement: Epsilon added\n\nThe system SHALL epsilon.\n\n#### Scenario: Epsilon happens\n\n- **WHEN** epsilon runs\n- **THEN** epsilon SHALL happen\n';

describe('classify', () => {
  test('buckets each shape', () => {
    expect(classify(WRAPPERLESS)).toBe('wrapperless');
    expect(classify(DELTA_ONLY)).toBe('delta');
    expect(classify(CANONICAL)).toBe('canonical');
    expect(classify(MIXED)).toBe('mixed');
    expect(classify('just prose, no requirements')).toBe('no-requirements');
  });
});

describe('canonicalize', () => {
  test('wraps wrapperless text verbatim', () => {
    const out = canonicalize('alpha-cap', WRAPPERLESS);
    expect(out.text).toContain('## Purpose');
    expect(out.text).toContain('## Requirements');
    expect(out.text).toContain('### Requirement: Alpha does a thing');
    expect(out.text).toContain('The system SHALL alpha.');
  });

  test('merges deltas: MODIFIED wins, REMOVED recorded', () => {
    const out = canonicalize('beta-cap', DELTA_ONLY);
    expect(out.text).toContain('SHALL beta twice');
    expect(out.text).not.toContain('The system SHALL beta.\n');
    expect(out.text).not.toContain('## ADDED');
    expect(out.removed).toEqual(['Gamma retired']);
  });

  test('canonical file is idempotent', () => {
    const out = canonicalize('delta-cap', CANONICAL);
    expect(out.changed).toBe(false);
  });

  test('mixed file appends ADDED requirement into Requirements', () => {
    const out = canonicalize('mixed-cap', MIXED);
    expect(out.text).toContain('### Requirement: Epsilon added');
    expect(out.text).not.toContain('## ADDED');
    expect(out.text).toContain('Existing purpose.');
  });

  test('hoists requirements out of a title section and drops the header', () => {
    const src = `## Widget Thing Specification

### Requirement: Zeta works

The widget SHALL zeta.

#### Scenario: Zeta happens

- **WHEN** zeta runs
- **THEN** zeta SHALL work
`;
    const out = canonicalize('widget-thing', src);
    expect(out.text).toContain('## Requirements');
    expect(out.text).toContain('### Requirement: Zeta works');
    expect(out.text).not.toContain('## Widget Thing Specification');
  });

  test('uses title-section prose before first requirement as Purpose', () => {
    const src = `## Widget Thing Specification

Widgets do things for users.

### Requirement: Zeta works

The widget SHALL zeta.

#### Scenario: Zeta happens

- **WHEN** zeta runs
- **THEN** zeta SHALL work
`;
    const out = canonicalize('widget-thing', src);
    expect(out.text).toContain('## Purpose\n\nWidgets do things for users.');
  });

  test('adds Purpose to a Requirements-only file, preserving requirements', () => {
    const src = `## Requirements

### Requirement: Eta holds

The system SHALL eta.

#### Scenario: Eta happens

- **WHEN** eta runs
- **THEN** eta SHALL hold
`;
    expect(classify(src)).not.toBe('canonical');
    const out = canonicalize('eta-cap', src);
    expect(out.text).toContain('## Purpose');
    expect(out.text).toContain('### Requirement: Eta holds');
  });

  test('h1 preamble prose becomes Purpose; h1 line dropped', () => {
    const src = `# my-cap

Intro prose describing the capability.

## Requirements

### Requirement: Theta stands

The system SHALL theta.

#### Scenario: Theta happens

- **WHEN** theta runs
- **THEN** theta SHALL stand
`;
    const out = canonicalize('my-cap', src);
    expect(out.text).toContain(
      '## Purpose\n\nIntro prose describing the capability.'
    );
    expect(out.text).not.toContain('# my-cap\n');
  });
});
