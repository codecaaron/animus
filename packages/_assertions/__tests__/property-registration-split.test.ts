import { describe, expect, it } from 'vitest';

import {
  AssertionError,
  assertPropertyRegistrationSplit,
  type SplitStylesheetParts,
} from '../src/assert-css';

// Shapes mirror `assembleStylesheet({ split: true })`: declaration carries the
// @layer ordering line, variables carries the pre-@layer custom-property CSS
// (now including @property registration rules), body carries global+component.
const DECLARATION = '@layer anm-global, anm-base, anm-variants;\n';
const VARIABLES = [
  '@property --current-bg { syntax: "<color>"; inherits: true; initial-value: transparent; }',
  '',
  ':root {\n  --color-primary: #abc;\n}',
].join('\n');
const BODY = '@layer anm-base { .animus-card { padding: 8px; } }';

function makeParts(
  overrides: Partial<SplitStylesheetParts> = {}
): SplitStylesheetParts {
  return {
    declaration: DECLARATION,
    variables: VARIABLES,
    body: BODY,
    ...overrides,
  };
}

function rejoin(parts: SplitStylesheetParts): string {
  return [parts.declaration, parts.variables, parts.body]
    .filter(Boolean)
    .join('\n');
}

describe('assertPropertyRegistrationSplit', () => {
  it('passes when @property is in variables, absent from body, and the concat holds', () => {
    const parts = makeParts();
    expect(() =>
      assertPropertyRegistrationSplit(parts, rejoin(parts))
    ).not.toThrow();
  });

  it('throws when the variables part has no @property rule', () => {
    const parts = makeParts({ variables: ':root {\n  --color-primary: #abc;\n}' });
    expect(() =>
      assertPropertyRegistrationSplit(parts, rejoin(parts))
    ).toThrow(AssertionError);
  });

  it('throws when @property leaks into the body part', () => {
    const parts = makeParts({
      body: `${BODY}\n@property --leak { syntax: "*"; inherits: false; }`,
    });
    expect(() =>
      assertPropertyRegistrationSplit(parts, rejoin(parts))
    ).toThrow(/body part must contain no @property/);
  });

  it('throws when @property leaks into the declaration part', () => {
    const parts = makeParts({
      declaration: `${DECLARATION}@property --leak { syntax: "*"; inherits: false; }`,
    });
    expect(() =>
      assertPropertyRegistrationSplit(parts, rejoin(parts))
    ).toThrow(/declaration part must contain no @property/);
  });

  it('throws when the declaration lacks the @layer ordering statement', () => {
    const parts = makeParts({ declaration: '/* no layer decl */\n' });
    // A declaration without @layer also contains no @property, so the failure
    // is specifically the missing @layer ordering statement.
    expect(() =>
      assertPropertyRegistrationSplit(parts, rejoin(parts))
    ).toThrow(/@layer ordering statement/);
  });

  it('throws when the rejoined parts do not equal the non-split output', () => {
    const parts = makeParts();
    expect(() =>
      assertPropertyRegistrationSplit(parts, `${rejoin(parts)}/* drift */`)
    ).toThrow(/do not equal the non-split output/);
  });
});
