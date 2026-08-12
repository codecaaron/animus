import { describe, expect, it } from 'vitest';

import { EvidenceLedger } from '../src/core/evidence';
import { asDependencyId, asTargetId } from '../src/core/identity';
import { eq, TRUE } from '../src/core/predicate';
import { exact } from '../src/core/value';

import type { RenderEvidence } from '../src/core/evidence';
import type { RenderSubject } from '../src/core/fact';
import type { DependencyId } from '../src/core/identity';

const target = asTargetId('src/Alert.tsx::Alert');
const subject: RenderSubject = { kind: 'style-target', target };
const other: RenderSubject = { kind: 'component', component: 'Alert' };

const alertFile = asDependencyId('src/Alert.tsx');
const themeFile = asDependencyId('src/theme.ts');

const evidence = (
  property: string,
  value: string,
  dependencies: readonly DependencyId[]
): Omit<RenderEvidence, 'id'> => ({
  subject,
  fact: exact(value),
  property,
  scenarioGuard: TRUE,
  environment: 'chromium-stable',
  kind: 'static-proof',
  dependencies,
  dependencyFingerprint: dependencies.join('|'),
  modelVersion: 'oracle-0.1',
});

describe('EvidenceLedger.assimilate', () => {
  it('is content-addressed', () => {
    const ledger = new EvidenceLedger();
    const first = ledger.assimilate(evidence('padding', '12px', [alertFile]));
    const second = ledger.assimilate(evidence('padding', '12px', [alertFile]));

    expect(second).toBe(first);
    expect(ledger.all()).toHaveLength(1);
    expect(first.id).toMatch(/^[0-9a-f]{16}$/);
  });

  it('separates evidence that differs anywhere in its content', () => {
    const ledger = new EvidenceLedger();
    const base = ledger.assimilate(evidence('padding', '12px', [alertFile]));
    const guarded = ledger.assimilate({
      ...evidence('padding', '12px', [alertFile]),
      scenarioGuard: eq('mode', 'dark'),
    });

    expect(guarded.id).not.toBe(base.id);
    expect(ledger.all()).toHaveLength(2);
  });
});

describe('EvidenceLedger.validFor', () => {
  it('filters by subject and optionally by property', () => {
    const ledger = new EvidenceLedger();
    ledger.assimilate(evidence('padding', '12px', [alertFile]));
    ledger.assimilate(evidence('margin', '0', [alertFile]));
    ledger.assimilate({
      ...evidence('padding', '12px', [alertFile]),
      subject: other,
    });

    expect(ledger.validFor(subject)).toHaveLength(2);
    expect(ledger.validFor(subject, 'padding')).toHaveLength(1);
    expect(ledger.validFor({ kind: 'world' })).toEqual([]);
  });
});

describe('EvidenceLedger.invalidate', () => {
  const seeded = () => {
    const ledger = new EvidenceLedger();
    const onAlert = ledger.assimilate(evidence('padding', '12px', [alertFile]));
    const onTheme = ledger.assimilate(evidence('color', 'red', [themeFile]));
    const onBoth = ledger.assimilate(
      evidence('gap', '4px', [alertFile, themeFile])
    );
    return { ledger, onAlert, onTheme, onBoth };
  };

  it('removes and returns exactly the intersecting evidence', () => {
    const { ledger, onAlert, onTheme, onBoth } = seeded();
    const removed = ledger.invalidate(new Set([themeFile]));

    expect(removed.map((e) => e.id).sort()).toEqual(
      [onTheme.id, onBoth.id].sort()
    );
    expect(ledger.all().map((e) => e.id)).toEqual([onAlert.id]);
  });

  it('is a no-op for an unrelated dependency', () => {
    const { ledger } = seeded();
    const revisionBefore = ledger.revision();

    expect(
      ledger.invalidate(new Set([asDependencyId('src/other.ts')]))
    ).toEqual([]);
    expect(ledger.all()).toHaveLength(3);
    expect(ledger.revision()).toBe(revisionBefore);
  });
});

describe('EvidenceLedger.revision', () => {
  it('changes when the valid set changes, in either direction', () => {
    const ledger = new EvidenceLedger();
    const empty = ledger.revision();

    ledger.assimilate(evidence('padding', '12px', [alertFile]));
    const afterAdd = ledger.revision();
    expect(afterAdd).not.toBe(empty);

    ledger.assimilate(evidence('padding', '12px', [alertFile]));
    expect(ledger.revision()).toBe(afterAdd);

    ledger.invalidate(new Set([alertFile]));
    expect(ledger.revision()).toBe(empty);
  });

  it('is insertion-order independent — it addresses the set, not the log', () => {
    const forward = new EvidenceLedger();
    forward.assimilate(evidence('padding', '12px', [alertFile]));
    forward.assimilate(evidence('color', 'red', [themeFile]));

    const backward = new EvidenceLedger();
    backward.assimilate(evidence('color', 'red', [themeFile]));
    backward.assimilate(evidence('padding', '12px', [alertFile]));

    expect(backward.revision()).toBe(forward.revision());
  });
});
