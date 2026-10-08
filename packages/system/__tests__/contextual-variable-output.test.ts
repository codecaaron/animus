import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { createTheme } from '../src';

const breakpoints = { sm: 640, md: 768, lg: 1024 };

/**
 * Every contextual-variable registration shape in one theme: declared with
 * and without metadata, universal, typed, non-inheriting and union syntax,
 * a re-registration (last wins), a repeat within a scale, one name on two
 * scales, and registration order that differs from declaration order.
 */
function everyRegistration() {
  return createTheme()
    .addBreakpoints(breakpoints)
    .addColors({ bg: '#000', fg: '#fff' })
    .addScale({ name: 'space', values: { sm: '4px' } })
    .declareContextualVars(
      { colors: ['plain', 'universal', 'typed', 'isolated'], space: ['gap'] },
      {
        isolated: {
          syntax: '<color> | transparent',
          inherits: false,
          initialValue: 'transparent',
        },
        universal: { syntax: '*', inherits: true },
        typed: {
          syntax: '<color>',
          inherits: true,
          initialValue: 'transparent',
        },
        gap: { inherits: false, syntax: '<length>', initialValue: '0px' },
      }
    )
    .declareContextualVars(
      { space: ['pad', 'gap'], colors: ['gap', 'plain', 'typed'] },
      {
        pad: { syntax: '<length>', inherits: true, initialValue: '0px' },
        typed: { syntax: '<color>', inherits: true, initialValue: 'black' },
      }
    )
    .build();
}

function source(name: string, inherits: boolean) {
  return createTheme()
    .addBreakpoints(breakpoints)
    .addScale({ name: 'space', values: { sm: '4px' } })
    .declareContextualVars(
      { space: [name, 'shared'] },
      { shared: { syntax: '<length>', inherits, initialValue: '0px' } }
    )
    .build();
}

/** Two extended sources share a registered name; local declarations follow. */
function extended() {
  return createTheme()
    .extend(source('gap', false))
    .extend(source('pad', false))
    .addColors({ bg: '#000' })
    .declareContextualVars(
      { colors: ['tone'], space: ['gap'] },
      { tone: { syntax: '*', inherits: false } }
    )
    .build();
}

/** `from()` replaces a scale's names, leaving a registered name undeclared. */
function replacedByFrom() {
  return createTheme()
    .addBreakpoints(breakpoints)
    .addScale({ name: 'space', values: { sm: '4px' } })
    .addColors({ bg: '#000' })
    .declareContextualVars(
      { colors: ['tone'], space: ['local'] },
      { local: { syntax: '*', inherits: true } }
    )
    .from(source('gap', true))
    .build();
}

// Recorded from the builder before contextual variables moved onto property
// records; every value must stay byte-identical.
const recorded = {
  everyRegistration: {
    variableCss:
      '@property --isolated { syntax: "<color> | transparent"; inherits: false; initial-value: transparent; }\n@property --universal { syntax: "*"; inherits: true; }\n@property --typed { syntax: "<color>"; inherits: true; initial-value: black; }\n@property --gap { syntax: "<length>"; inherits: false; initial-value: 0px; }\n@property --pad { syntax: "<length>"; inherits: true; initial-value: 0px; }\n\n:root {\n  --color-bg: #000;\n  --color-fg: #fff;\n  --breakpoint-lg: 1024px;\n  --breakpoint-md: 768px;\n  --breakpoint-sm: 640px;\n}',
    contextualVarsJson:
      '{"colors":["plain","universal","typed","isolated","gap","plain","typed"],"space":["gap","pad","gap"]}',
    registrationsJson:
      '{"isolated":{"syntax":"<color> | transparent","inherits":false,"initialValue":"transparent"},"universal":{"syntax":"*","inherits":true},"typed":{"syntax":"<color>","inherits":true,"initialValue":"black"},"gap":{"inherits":false,"syntax":"<length>","initialValue":"0px"},"pad":{"syntax":"<length>","inherits":true,"initialValue":"0px"}}',
    contractHash:
      '573e6c248413480196a7f7724af5ca89c9cd0c635908e77cb405e2c00299b9ca',
    manifestDigest:
      'e8987347c327a597dbf27f6977062459a0c1e3daae243b7e4cb0f075efce14cc',
  },
  extended: {
    variableCss:
      '@property --shared { syntax: "<length>"; inherits: false; initial-value: 0px; }\n@property --tone { syntax: "*"; inherits: false; }\n\n:root {\n  --color-bg: #000;\n  --breakpoint-lg: 1024px;\n  --breakpoint-md: 768px;\n  --breakpoint-sm: 640px;\n}',
    contextualVarsJson:
      '{"space":["gap","shared","pad","gap"],"colors":["tone"]}',
    registrationsJson:
      '{"shared":{"syntax":"<length>","inherits":false,"initialValue":"0px"},"tone":{"syntax":"*","inherits":false}}',
    contractHash:
      '80a4efb339156b2f46cc69e32690bc615b7d7d509f84c7dc100c5570f0c4e1bc',
    manifestDigest:
      '55de5ea44e1e650b127c4fb5e84e18514e274411570cc64f7c61b935a72bea03',
  },
  replacedByFrom: {
    variableCss:
      '@property --shared { syntax: "<length>"; inherits: true; initial-value: 0px; }\n\n:root {\n  --color-bg: #000;\n  --breakpoint-lg: 1024px;\n  --breakpoint-md: 768px;\n  --breakpoint-sm: 640px;\n}',
    contextualVarsJson: '{"colors":["tone"],"space":["gap","shared"]}',
    registrationsJson:
      '{"local":{"syntax":"*","inherits":true},"shared":{"syntax":"<length>","inherits":true,"initialValue":"0px"}}',
    contractHash:
      'e5a4356e0c5f5bb81c0554e2e5a218ba3dc231f46f35be022d9c453e784d68be',
    manifestDigest:
      'f8e3fc3c41d6cba9aa1548ab72a54caf5ba6e498928738130e3ddb2ddcfad61a',
  },
};

describe('contextual-variable output', () => {
  it.each([
    ['every registration shape', everyRegistration, recorded.everyRegistration],
    ['extended sources', extended, recorded.extended],
    ['a from() replacement', replacedByFrom, recorded.replacedByFrom],
  ] as const)('is unchanged for %s', (_label, build, expected) => {
    const theme = build();
    const serialized = theme.serialize();
    expect(serialized.variableCss).toBe(expected.variableCss);
    expect(serialized.contextualVarsJson).toBe(expected.contextualVarsJson);
    expect(JSON.stringify(theme.manifest.registrations)).toBe(
      expected.registrationsJson
    );
    expect(theme.manifest.contractHash).toBe(expected.contractHash);
    expect(
      createHash('sha256').update(JSON.stringify(theme.manifest)).digest('hex')
    ).toBe(expected.manifestDigest);
  });
});
