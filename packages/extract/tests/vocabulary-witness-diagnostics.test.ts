import { describe, expect, it } from 'vitest';

import {
  VOCABULARY_COLLISION,
  VOCABULARY_LEGACY_VERB,
  vocabularyWitnessDiagnostics,
} from '../pipeline';

describe('vocabularyWitnessDiagnostics — the one host mapper for the sealed record witness channel', () => {
  it('maps a collision entry to a coded warn naming both sources', () => {
    const diagnostics = vocabularyWitnessDiagnostics(
      JSON.stringify([
        {
          code: VOCABULARY_COLLISION,
          name: 'motion',
          winner: 'local registration #1',
          loser: 'extended source #1',
        },
      ])
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: VOCABULARY_COLLISION,
      severity: 'warn',
      component: 'motion',
    });
    expect(diagnostics[0]?.message).toContain('extended source #1');
    expect(diagnostics[0]?.message).toContain('local registration #1');
    expect(diagnostics[0]?.message).toContain(VOCABULARY_COLLISION);
  });

  it('maps a legacy-verb entry to a coded warn naming the verb, the source, and the refused names', () => {
    const diagnostics = vocabularyWitnessDiagnostics(
      JSON.stringify([
        {
          code: VOCABULARY_LEGACY_VERB,
          verb: 'includes',
          source: 'includes source #1',
          names: ['kitMotion'],
        },
      ])
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: VOCABULARY_LEGACY_VERB,
      severity: 'warn',
    });
    expect(diagnostics[0]?.message).toContain("'includes'");
    expect(diagnostics[0]?.message).toContain('includes source #1');
    expect(diagnostics[0]?.message).toContain('kitMotion');
  });

  it('fails closed on an unrecognized witness code — the entry surfaces instead of vanishing', () => {
    const diagnostics = vocabularyWitnessDiagnostics(
      JSON.stringify([{ code: 'animus.vocabulary.future-kind', detail: 1 }])
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: 'animus.vocabulary.future-kind',
      severity: 'warn',
    });
    expect(diagnostics[0]?.message).toContain(
      'unrecognized vocabulary witness'
    );
  });

  it('an absent or empty channel maps to zero diagnostics', () => {
    expect(vocabularyWitnessDiagnostics(null)).toEqual([]);
    expect(vocabularyWitnessDiagnostics(undefined)).toEqual([]);
  });
});
