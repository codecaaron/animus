// scripts/hygiene/presenter.test.ts
//
// Synthetic-fixture tests for the receipts → verdict transformation.
// The goal is to lock in the trust contract:
//   - cap-hit-clean must NEVER warn (this is the regression session-90 caught)
//   - cap-hit-divergent must surface the offending layer
//   - Layer D NOTE thresholds must match the spec (≥1 file OR ≥5 exports)
//   - code-drift must surface the codesSeen list

import { describe, expect, test } from 'vitest';

import {
  analyze,
  LAYER_D_EXPORT_THRESHOLD,
  LAYER_D_FILE_THRESHOLD,
  parseReceipts,
  type Verdict,
} from './presenter.ts';

import type { Receipt } from './_receipts';

function rec(
  partial: Partial<Receipt> & Pick<Receipt, 'iter' | 'layer' | 'verb' | 'kind'>
): Receipt {
  return {
    v: 1,
    target: 'fixture.ts:1',
    ...partial,
  } as Receipt;
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
    const malformed = '{"v":1,"iter":2,"layer":"C","verb":"delete"'; // missing closing brace
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
    expect(v.convergence).toBe('converged');
    expect(v.finalIteration).toBe(2);
    expect(v.finalIterationDeletes).toBe(0);
    expect(v.suggestedExitCode).toBe(0);
    expect(v.summaryLines[0]).toMatch(/converged in 2 iteration/);
  });

  test('converged immediately when no mutations at all', () => {
    const v = analyze([], 5);
    expect(v.convergence).toBe('converged');
    expect(v.suggestedExitCode).toBe(0);
    expect(v.summaryLines[0]).toMatch(/converged immediately/);
  });

  test('ranIters override: clean trailing iterations are recognized as convergence', () => {
    // Cascade ran 3 iterations: iter 1 had a Layer C delete, iters 2 & 3
    // produced no receipts (clean). Without the orchestrator-supplied
    // ranIters, the presenter would only see iter 1 and misclassify as
    // divergent (final-iter delete count > 0). With ranIters=3, the verdict
    // correctly reflects that iter 3 ran and emitted nothing.
    const records = [
      rec({ iter: 1, layer: 'C', verb: 'delete', kind: 'const-decl' }),
    ];
    const v = analyze(records, 5, 3);
    expect(v.convergence).toBe('converged');
    expect(v.finalIteration).toBe(3);
    expect(v.finalIterationDeletes).toBe(0);
    expect(v.suggestedExitCode).toBe(0);
  });

  test('ranIters override: cap-hit-clean when trailing clean iter equals cap', () => {
    const records = [
      rec({ iter: 1, layer: 'C', verb: 'delete', kind: 'const-decl' }),
    ];
    // ranIters = cap; iter 5 produced no receipts.
    const v = analyze(records, 5, 5);
    expect(v.convergence).toBe('cap-hit-clean');
    expect(v.finalIteration).toBe(5);
  });

  test('ranIters override: lower than receipts max — receipts max wins', () => {
    // Defensive: orchestrator under-reports ranIters; receipts say iter 4.
    const records = [
      rec({ iter: 1, layer: 'C', verb: 'delete', kind: 'const-decl' }),
      rec({ iter: 4, layer: 'C', verb: 'delete', kind: 'const-decl' }),
    ];
    const v = analyze(records, 5, 2);
    expect(v.finalIteration).toBe(4);
    expect(v.finalIterationDeletes).toBe(1);
    expect(v.convergence).toBe('cap-hit-divergent');
  });

  test('cap-hit-clean: 5 iters, last has zero deletes (cap=5)', () => {
    const records: Receipt[] = [];
    for (let i = 1; i <= 4; i++) {
      records.push(
        rec({ iter: i, layer: 'C', verb: 'delete', kind: 'const-decl' })
      );
    }
    // iter 5: only format receipts, no deletes
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
    // CRITICAL: must NOT contain the WARN string — this is the regression
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
    expect(v.convergence).toBe('cap-hit-divergent');
    expect(v.finalIterationDeletes).toBe(3);
    expect(v.suggestedExitCode).toBe(1);
    expect(v.summaryLines[0]).toMatch(/WARN: cascade did not converge/);
    expect(v.summaryLines[0]).toMatch(/iteration 5/);
    expect(v.summaryLines[0]).toMatch(/Layer C\/D/);
  });
});

describe('analyze: Layer D volume NOTE', () => {
  test('triggers on 1 file removal', () => {
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
    expect(v.layerDVolume.files).toBe(1);
    expect(
      v.summaryLines.some((l) => l.startsWith('NOTE: Layer D removed'))
    ).toBe(true);
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

  test('threshold constants match spec', () => {
    expect(LAYER_D_FILE_THRESHOLD).toBe(1);
    expect(LAYER_D_EXPORT_THRESHOLD).toBe(5);
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
    expect(v.suggestedExitCode).toBe(0); // drift is informational, not divergent
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
  test('Layer D NOTE on cap-hit-clean does not change exit code', () => {
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
    expect(v.suggestedExitCode).toBe(0);
    expect(v.summaryLines.length).toBe(2); // INFO + NOTE
  });
});
