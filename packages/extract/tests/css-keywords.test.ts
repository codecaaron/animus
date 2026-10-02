import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

import {
  checkFormatterRun,
  deriveCssKeywords,
  KEYWORD_FILE,
  probeLiterals,
} from '../scripts/css-keywords';

import type { ToolRun } from '../scripts/css-keywords';

describe('css keywords', () => {
  const derived = deriveCssKeywords();

  test('the extractor table matches the public strict-type contract', () => {
    expect(JSON.parse(readFileSync(KEYWORD_FILE, 'utf8'))).toEqual(derived);
  });

  test('keeps the per-property keywords the strict types admit', () => {
    expect(derived.globals).toEqual([
      '-moz-initial',
      'inherit',
      'initial',
      'revert',
      'revert-layer',
      'unset',
    ]);
    expect(derived.properties.margin).toEqual(['auto']);
    expect(derived.properties.color).toEqual(['currentColor', 'transparent']);
    expect(derived.properties.padding).toBeUndefined();
  });
});

describe('css keyword probe validation', () => {
  const probes = ['P0', 'P1'];
  const probe = (line: number, type: string, column = 14) =>
    `../tmp/probe.ts(${line},${column}): error TS2322: Type 'unique symbol' is not assignable to type '${type}'.`;
  const run = (
    stdout: string[],
    overrides: Partial<ToolRun> = {}
  ): ToolRun => ({
    status: 1,
    signal: null,
    stdout: `${stdout.join('\n')}\n`,
    stderr: '',
    ...overrides,
  });
  const complete = [probe(4, '"auto" | "inherit" | 0n'), probe(5, '0n')];

  test('reads each probe, including a valid probe with no keywords', () => {
    expect(probeLiterals(run(complete), 4, probes)).toEqual([
      ['auto', 'inherit'],
      [],
    ]);
  });

  test.each<[string, ToolRun]>([
    [
      'a spawn error',
      { ...run(complete), error: new Error('spawn ENOENT'), status: null },
    ],
    ['a signal', { ...run(complete), status: null, signal: 'SIGKILL' }],
    ['an unexpected exit status', { ...run(complete), status: 2 }],
    ['compiler stderr', { ...run(complete), stderr: 'heap out of memory' }],
  ])('fails on %s', (_, failed) => {
    expect(() => probeLiterals(failed, 4, probes)).toThrow(/css-keywords: tsc/);
  });

  test.each([
    [
      'an unrelated diagnostic',
      [
        ...complete,
        "../tmp/probe.ts(2,6): error TS6196: 'Literal' is declared but never used.",
      ],
    ],
    [
      'a non-probe TS2322',
      [
        ...complete,
        "../tmp/probe.ts(9,14): error TS2322: Type 'unique symbol' is not assignable to type '0n'.",
      ],
    ],
    ['a probe at another column', [probe(4, '0n'), probe(5, '0n', 20)]],
    [
      'an unrecognized probe diagnostic',
      [
        probe(4, '0n'),
        "../tmp/probe.ts(5,14): error TS2344: Type 'x' does not satisfy the constraint 'y'.",
      ],
    ],
  ])('fails on %s', (_, stdout) => {
    expect(() => probeLiterals(run(stdout), 4, probes)).toThrow(
      /css-keywords: unexpected compiler output/
    );
  });

  test('fails when a probe has no diagnostic', () => {
    expect(() => probeLiterals(run([probe(4, '0n')]), 4, probes)).toThrow(
      /css-keywords: no diagnostic for probe 1 \(P1\)/
    );
  });

  test('fails when a probe has two diagnostics', () => {
    expect(() =>
      probeLiterals(run([...complete, probe(5, '0n')]), 4, probes)
    ).toThrow(/css-keywords: two diagnostics for probe 1 \(P1\)/);
  });

  test('fails when formatting fails', () => {
    expect(() => checkFormatterRun(run([], { status: 1 }))).toThrow(
      /css-keywords: vp fmt/
    );
    expect(() =>
      checkFormatterRun(
        run([], { error: new Error('spawn ENOENT'), status: null })
      )
    ).toThrow(/css-keywords: vp fmt/);
    expect(() => checkFormatterRun(run([], { status: 0 }))).not.toThrow();
  });
});
