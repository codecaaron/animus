import { describe, expect, test } from 'vitest';

import { analyze, parseReceipts, type Verdict } from './presenter';

import type { Receipt } from './_receipts';

function rec(
  partial: Partial<Receipt> & Pick<Receipt, 'iter' | 'layer' | 'verb' | 'kind'>
): Receipt {
  return {
    v: 1,
    target: 'fixture.ts:1',
    ...partial,
  };
}

function jsonl(records: Receipt[]): string {
  return records.map((r) => JSON.stringify(r)).join('\n') + '\n';
}

describe('parseReceipts', () => {
  test('parses well-formed JSONL', () => {
    const records = [
      rec({ iter: 1, layer: 'C', verb: 'delete', kind: 'const-decl' }),
      rec({
        iter: 1,
        layer: 'D',
        verb: 'delete',
        kind: 'file',
        target: 'a.ts',
      }),
    ];
    const parsed = parseReceipts(jsonl(records));
    expect(parsed).toHaveLength(2);
    expect(parsed[0].layer).toBe('C');
    expect(parsed[1].kind).toBe('file');
  });

  test('skips blank lines and partial trailing line', () => {
    const valid = JSON.stringify(
      rec({ iter: 1, layer: 'C', verb: 'delete', kind: 'const-decl' })
    );
    const malformed = '{"v":1,"iter":2,"layer":"C","verb":"delete"';
    const parsed = parseReceipts(`\n${valid}\n\n${malformed}\n`);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].iter).toBe(1);
  });

  test('rejects records missing required v1 fields', () => {
    const incomplete = JSON.stringify({ iter: 1, layer: 'C' });
    const wrongVersion = JSON.stringify({
      ...rec({ iter: 1, layer: 'C', verb: 'delete', kind: 'const-decl' }),
      v: 2,
    });
    const parsed = parseReceipts(`${incomplete}\n${wrongVersion}\n`);
    expect(parsed).toHaveLength(0);
  });
});

describe('analyze: convergence verdict', () => {
  test('converged-in-2-iters: deletes in iter 1, none in iter 2 (cap=5)', () => {
    const records = [
      rec({ iter: 1, layer: 'C', verb: 'delete', kind: 'const-decl' }),
      rec({ iter: 1, layer: 'C', verb: 'delete', kind: 'const-decl' }),
      rec({ iter: 2, layer: 'A', verb: 'format', kind: 'format-only' }),
    ];
    const v = analyze(records, 5);
    expect(v).toMatchObject({
      convergence: 'converged',
      finalIteration: 2,
      finalIterationDeletes: 0,
      suggestedExitCode: 0,
    });
    expect(v.summaryLines[0]).toMatch(/converged in 2 iteration/);
  });

  test('converged immediately when no mutations at all', () => {
    const v = analyze([], 5);
    expect(v.convergence).toBe('converged');
    expect(v.suggestedExitCode).toBe(0);
    expect(v.summaryLines[0]).toMatch(/converged immediately/);
  });

  test('ranIters override: clean trailing iterations are recognized as convergence', () => {
    // A clean iteration emits no receipts, so receipts alone stop at iter 1
    // and read as divergent; ranIters reports the trailing iterations.
    const records = [
      rec({ iter: 1, layer: 'C', verb: 'delete', kind: 'const-decl' }),
    ];
    const v = analyze(records, 5, 3);
    expect(v).toMatchObject({
      convergence: 'converged',
      finalIteration: 3,
      finalIterationDeletes: 0,
      suggestedExitCode: 0,
    });
  });

  test('ranIters override: cap-hit-clean when trailing clean iter equals cap', () => {
    const records = [
      rec({ iter: 1, layer: 'C', verb: 'delete', kind: 'const-decl' }),
    ];
    const v = analyze(records, 5, 5);
    expect(v.convergence).toBe('cap-hit-clean');
    expect(v.finalIteration).toBe(5);
  });

  test('ranIters override: lower than receipts max — receipts max wins', () => {
    const records = [
      rec({ iter: 1, layer: 'C', verb: 'delete', kind: 'const-decl' }),
      rec({ iter: 4, layer: 'C', verb: 'delete', kind: 'const-decl' }),
    ];
    const v = analyze(records, 5, 2);
    expect(v).toMatchObject({
      convergence: 'cap-hit-divergent',
      finalIteration: 4,
      finalIterationDeletes: 1,
    });
  });

  test('cap-hit-clean: 5 iters, last has zero deletes (cap=5)', () => {
    const records: Receipt[] = [];
    for (let i = 1; i <= 4; i++) {
      records.push(
        rec({ iter: i, layer: 'C', verb: 'delete', kind: 'const-decl' })
      );
    }
    records.push(
      rec({ iter: 5, layer: 'A', verb: 'format', kind: 'format-only' })
    );
    records.push(
      rec({ iter: 5, layer: 'A', verb: 'format', kind: 'format-only' })
    );
    const v = analyze(records, 5);
    expect(v.convergence).toBe('cap-hit-clean');
    expect(v.suggestedExitCode).toBe(0);
    expect(v.summaryLines[0]).toMatch(/INFO: cascade settled at iteration cap/);
    expect(
      v.summaryLines.some((l) => l.startsWith('WARN: cascade did not converge'))
    ).toBe(false);
  });

  test('cap-hit-divergent: 5 iters, last iter has 3 deletes (cap=5)', () => {
    const records: Receipt[] = [];
    for (let i = 1; i <= 5; i++) {
      records.push(
        rec({ iter: i, layer: 'C', verb: 'delete', kind: 'const-decl' })
      );
      records.push(
        rec({ iter: i, layer: 'C', verb: 'delete', kind: 'const-decl' })
      );
      records.push(
        rec({
          iter: i,
          layer: 'D',
          verb: 'delete',
          kind: 'file',
          target: 'orphan.ts',
        })
      );
    }
    const v = analyze(records, 5);
    expect(v).toMatchObject({
      convergence: 'cap-hit-divergent',
      finalIterationDeletes: 3,
      suggestedExitCode: 1,
    });
    expect(v.summaryLines[0]).toMatch(/WARN: cascade did not converge/);
    expect(v.summaryLines[0]).toMatch(/iteration 5/);
    expect(v.summaryLines[0]).toMatch(/Layer C\/D/);
  });
});

describe('analyze: Layer D volume NOTE', () => {
  test('1 file removal blocks with manual-review (fail-closed, G7)', () => {
    const records = [
      rec({
        iter: 1,
        layer: 'D',
        verb: 'delete',
        kind: 'file',
        target: 'orphan.ts',
      }),
    ];
    const v = analyze(records, 5);
    expect(v).toMatchObject({
      layerDVolume: expect.objectContaining({ files: 1 }),
      riskyDeletion: true,
      suggestedExitCode: 1,
    });
    expect(
      v.summaryLines.some((l) => l.startsWith('MANUAL REVIEW REQUIRED'))
    ).toBe(true);
    expect(
      v.summaryLines.some((l) => l.startsWith('NOTE: Layer D removed'))
    ).toBe(false);
  });

  test('triggers on 5 export removals', () => {
    const records: Receipt[] = [];
    for (let i = 0; i < 5; i++) {
      records.push(
        rec({ iter: 1, layer: 'D', verb: 'delete', kind: 'export-clause' })
      );
    }
    const v = analyze(records, 5);
    expect(v.layerDVolume.exports).toBe(5);
    expect(
      v.summaryLines.some((l) => l.startsWith('NOTE: Layer D removed'))
    ).toBe(true);
  });

  test('does NOT trigger on 2 export removals', () => {
    const records = [
      rec({ iter: 1, layer: 'D', verb: 'delete', kind: 'export-clause' }),
      rec({ iter: 1, layer: 'D', verb: 'delete', kind: 'export-clause' }),
    ];
    const v = analyze(records, 5);
    expect(v.layerDVolume.exports).toBe(2);
    expect(
      v.summaryLines.some((l) => l.startsWith('NOTE: Layer D removed'))
    ).toBe(false);
  });
});

describe('analyze: code-drift', () => {
  test('drift receipt produces codeDrift list and WARN line', () => {
    const records = [
      rec({
        iter: 1,
        layer: 'C',
        verb: 'drift-suspected',
        kind: 'code-drift',
        target: '<oxlint>',
        extras: {
          codesSeen: [
            'eslint(some-other-style)',
            'eslint(unknown-renamed-rule)',
          ],
        },
      }),
    ];
    const v = analyze(records, 5);
    expect(v.codeDrift).toEqual([
      'eslint(some-other-style)',
      'eslint(unknown-renamed-rule)',
    ]);
    expect(
      v.summaryLines.some((l) =>
        l.startsWith('WARN: oxlint diagnostics present')
      )
    ).toBe(true);
  });

  test('drift WARN coexists with convergence verdict', () => {
    const records = [
      rec({
        iter: 1,
        layer: 'C',
        verb: 'drift-suspected',
        kind: 'code-drift',
        target: '<oxlint>',
        extras: { codesSeen: ['eslint(yet-another-rule)'] },
      }),
      rec({ iter: 2, layer: 'A', verb: 'format', kind: 'format-only' }),
    ];
    const v = analyze(records, 5);
    expect(v.convergence).toBe('converged');
    expect(v.suggestedExitCode).toBe(0);
    expect(v.summaryLines.length).toBeGreaterThanOrEqual(2);
    expect(v.summaryLines[0]).toMatch(/converged/);
    expect(
      v.summaryLines.some((l) =>
        l.startsWith('WARN: oxlint diagnostics present')
      )
    ).toBe(true);
  });

  test('no drift receipts → no codeDrift field', () => {
    const records = [
      rec({ iter: 1, layer: 'C', verb: 'delete', kind: 'const-decl' }),
    ];
    const v = analyze(records, 5);
    expect(v.codeDrift).toBeUndefined();
  });
});

describe('analyze: combined signals', () => {
  test('export-only nudge on cap-hit-clean does not change exit code', () => {
    const records: Receipt[] = [];
    for (let i = 1; i <= 4; i++) {
      records.push(
        rec({ iter: i, layer: 'D', verb: 'delete', kind: 'export-clause' })
      );
      records.push(
        rec({ iter: i, layer: 'D', verb: 'delete', kind: 'export-clause' })
      );
    }
    records.push(
      rec({ iter: 5, layer: 'A', verb: 'format', kind: 'format-only' })
    );
    const v: Verdict = analyze(records, 5);
    expect(v).toMatchObject({
      convergence: 'cap-hit-clean',
      layerDVolume: expect.objectContaining({ files: 0, exports: 8 }),
    });
    expect(v.riskyDeletion).toBe(false);
    expect(v.suggestedExitCode).toBe(0);
    expect(v.summaryLines.length).toBe(2);
  });

  test('whole-file deletion on cap-hit-clean forces manual-review exit (G7)', () => {
    const records: Receipt[] = [];
    for (let i = 1; i <= 4; i++) {
      records.push(
        rec({
          iter: i,
          layer: 'D',
          verb: 'delete',
          kind: 'file',
          target: `o${i}.ts`,
        })
      );
    }
    records.push(
      rec({ iter: 5, layer: 'A', verb: 'format', kind: 'format-only' })
    );
    const v: Verdict = analyze(records, 5);
    expect(v.convergence).toBe('cap-hit-clean');
    expect(v.layerDVolume.files).toBe(4);
    expect(v.riskyDeletion).toBe(true);
    expect(v.suggestedExitCode).toBe(1);
    expect(
      v.summaryLines.some((l) => l.startsWith('MANUAL REVIEW REQUIRED'))
    ).toBe(true);
  });
});

describe('analyze: risky whole-file deletion (G7)', () => {
  test('requires manual review after whole-file deletion', () => {
    const records = [
      rec({ iter: 1, layer: 'C', verb: 'delete', kind: 'const-decl' }),
      rec({
        iter: 1,
        layer: 'D',
        verb: 'delete',
        kind: 'file',
        target: 'orphan-module.ts',
      }),
      rec({ iter: 2, layer: 'A', verb: 'format', kind: 'format-only' }),
    ];
    const v = analyze(records, 5);
    expect(v.convergence).toBe('converged');
    expect(v.finalIterationDeletes).toBe(0);
    expect(v.riskyDeletion).toBe(true);
    expect(v.suggestedExitCode).toBe(1);
    expect(
      v.summaryLines.some((l) => l.startsWith('MANUAL REVIEW REQUIRED'))
    ).toBe(true);
  });

  test('behavior-build proof suppresses the block', () => {
    // The trailing clean iteration keeps convergence out of cap-hit-divergent
    // so the proof marker's effect is the only variable.
    const records = [
      rec({
        iter: 1,
        layer: 'D',
        verb: 'delete',
        kind: 'file',
        target: 'orphan.ts',
        extras: { behaviorBuildProof: true },
      }),
      rec({ iter: 2, layer: 'A', verb: 'format', kind: 'format-only' }),
    ];
    const v = analyze(records, 5);
    expect(v.convergence).toBe('converged');
    expect(v.riskyDeletion).toBe(false);
    expect(v.suggestedExitCode).toBe(0);
    expect(
      v.summaryLines.some((l) => l.startsWith('MANUAL REVIEW REQUIRED'))
    ).toBe(false);
  });
});
