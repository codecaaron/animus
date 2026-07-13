/**
 * Synthetic-divergence tests: the harness must DETECT fabricated
 * divergences in every artifact class and classify CSS failures — a green
 * identity run means nothing if the comparator is blind.
 */
import { describe, expect, test } from 'vitest';

import {
  classifyCssDivergence,
  codeAstEquivalent,
  compareUnit,
} from '../src/compare';
import { matchRegister } from '../src/register';
import { familyViolations } from '../src/scoreboard';

import type { Divergence, RegisterEntry, UnitSurface } from '../src/types';

function surface(overrides: Partial<UnitSurface> = {}): UnitSurface {
  return {
    css: '@layer anm-base;\n.a { display: flex; }\n',
    code: { 'a.tsx': 'export const x = 1;\n' },
    hasComponents: { 'a.tsx': true },
    diagnostics: [],
    observables: {
      componentFragmentKeys: ['a::X'],
      reverseProvenanceEdges: [],
      systemPropMapJson: '{}',
      dynamicPropsJson: '{}',
      sheetsJson: '{}',
      componentFragmentsJson: '{}',
    },
    parseCount: null,
    ...overrides,
  };
}

describe('CSS classification', () => {
  test('whitespace-only difference classifies as formatting', async () => {
    expect(
      await classifyCssDivergence('.a { color: red; }', '.a{color:red}')
    ).toBe('formatting');
  });

  test('same rules reordered classifies as rule-order', async () => {
    expect(
      await classifyCssDivergence(
        '.a{color:red}.b{color:blue}',
        '.b{color:blue}.a{color:red}'
      )
    ).toBe('rule-order');
  });

  test('rules reordered INSIDE a layer classify as rule-order', async () => {
    expect(
      await classifyCssDivergence(
        '@layer anm-base{.a{color:red}.b{color:blue}}',
        '@layer anm-base{.b{color:blue}.a{color:red}}'
      )
    ).toBe('rule-order');
  });

  test('same selectors different value classifies as value', async () => {
    expect(await classifyCssDivergence('.a{color:red}', '.a{color:blue}')).toBe(
      'value'
    );
  });

  test('different selector classifies as selector', async () => {
    expect(await classifyCssDivergence('.a{color:red}', '.zz{color:red}')).toBe(
      'selector'
    );
  });
});

describe('code AST equivalence', () => {
  test('quote style and object key order are equivalent', async () => {
    expect(
      await codeAstEquivalent(
        `createComponent('div', {"a":1,"b":2});`,
        `createComponent("div", {"b":2,"a":1});`,
        'x.tsx'
      )
    ).toBe(true);
  });

  test('a real value change is NOT equivalent', async () => {
    expect(
      await codeAstEquivalent(
        `createComponent('div', {"a":1});`,
        `createComponent('div', {"a":2});`,
        'x.tsx'
      )
    ).toBe(false);
  });

  test('spread position is order-sensitive (NOT equivalent)', async () => {
    expect(
      await codeAstEquivalent(
        `const x = {...base, color: 1};`,
        `const x = {color: 1, ...base};`,
        'x.tsx'
      )
    ).toBe(false);
  });

  test('duplicate keys are order-sensitive (NOT equivalent)', async () => {
    expect(
      await codeAstEquivalent(
        `const x = {"a":1, "a":2};`,
        `const x = {"a":2, "a":1};`,
        'x.ts'
      )
    ).toBe(false);
  });
});

describe('compareUnit detects synthetic divergences per artifact class', () => {
  test('identical surfaces produce zero divergences', async () => {
    expect(await compareUnit('u', surface(), surface())).toEqual([]);
  });

  test('css byte difference detected and classified', async () => {
    const divs = await compareUnit(
      'u',
      surface(),
      surface({ css: '@layer anm-base;\n.a { display: grid; }\n' })
    );
    const cssDiv = divs.find((d) => d.artifact === 'css');
    expect(cssDiv).toBeDefined();
    expect(cssDiv!.classification).toBe('value');
  });

  test('non-equivalent transformed code detected', async () => {
    const divs = await compareUnit(
      'u',
      surface(),
      surface({ code: { 'a.tsx': 'export const x = 2;\n' } })
    );
    expect(divs.some((d) => d.artifact === 'code')).toBe(true);
  });

  test('observable and diagnostics differences detected', async () => {
    const divs = await compareUnit(
      'u',
      surface(),
      surface({
        observables: {
          componentFragmentKeys: ['a::X', 'a::Y'],
          reverseProvenanceEdges: ['p->c'],
          systemPropMapJson: '{"m":{}}',
          dynamicPropsJson: '{}',
          sheetsJson: '{"base":".x{}"}',
          componentFragmentsJson: '{}',
        },
        diagnostics: ['a.tsx|bail|X|reason'],
      })
    );
    expect(
      divs.filter((d) => d.artifact === 'observables').length
    ).toBeGreaterThanOrEqual(3);
    expect(divs.some((d) => d.artifact === 'diagnostics')).toBe(true);
  });

  test('invalid CSS reported as css-validity', async () => {
    const divs = await compareUnit(
      'u',
      surface({ css: '.a { box-shadow: 0 0 8px {colors.broken}; }' }),
      surface({ css: '.a { box-shadow: 0 0 8px {colors.broken}; }' })
    );
    expect(divs.filter((d) => d.artifact === 'css-validity').length).toBe(2);
  });
});

describe('register matching', () => {
  const div: Divergence = { unit: 'parity/x', artifact: 'code', detail: 'd' };

  test('active entry registers a divergence; anticipated does not', () => {
    const active: RegisterEntry = {
      unit: 'parity/x',
      artifact: 'code',
      category: 'known-quirk',
      note: '',
      status: 'active',
    };
    const anticipated: RegisterEntry = { ...active, status: 'anticipated' };
    expect(matchRegister([div], [active])[0].registered).toBeDefined();
    expect(matchRegister([div], [anticipated])[0].registered).toBeUndefined();
  });

  test('prefix and any-artifact matching', () => {
    const entry: RegisterEntry = {
      unit: 'parity/',
      artifact: 'any',
      category: 'ordering',
      note: '',
      status: 'active',
    };
    expect(matchRegister([div], [entry])[0].registered).toBeDefined();
  });
});

describe('family verdict enforcement', () => {
  test('identical-expected family with divergence is violated', () => {
    const errs = familyViolations(
      [{ family: 'f', units: ['u1'], expectedVerdict: 'identical' }],
      [{ unit: 'u1', artifact: 'css', detail: 'd' }]
    );
    expect(errs.length).toBe(1);
  });

  test('registered-divergence family with no divergence is violated', () => {
    const errs = familyViolations(
      [
        {
          family: 'f',
          units: ['u1'],
          expectedVerdict: 'registered-divergence',
        },
      ],
      []
    );
    expect(errs.length).toBe(1);
  });
});
