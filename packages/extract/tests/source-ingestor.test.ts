import { describe, expect, test } from 'vitest';

import { createSourceIngestor } from '../pipeline/source-ingestion';
import {
  ADVISORY_DIAGNOSTIC as advisory,
  FATAL_DIAGNOSTIC as fatal,
  makeHost,
} from './source-ingestion-fixtures';

describe('createSourceIngestor', () => {
  test('an engine without extractFacts fails loud at ingestion, naming the host', async () => {
    const ingestor = createSourceIngestor(makeHost());

    await expect(ingestor.ingest([])).rejects.toThrow(
      '[animus-test] native engine does not expose extractFacts required for source adaptation'
    );
  });

  test('fatal diagnostics quarantine and warn once per original in non-strict mode', () => {
    const warnings: string[] = [];
    const ingestor = createSourceIngestor(makeHost({ warnings }));

    expect(ingestor.surfaceDiagnostics([fatal])).toEqual(
      new Set(['src/Usage.svelte'])
    );
    expect(warnings).toEqual([
      expect.stringContaining(
        'SOURCE_SVELTE_DEPENDENCY_MISSING src/Usage.svelte'
      ),
    ]);

    ingestor.surfaceDiagnostics([fatal]);
    expect(warnings).toHaveLength(1);
    ingestor.surfaceDiagnostics([
      { ...fatal, message: 'a different failure on the same file' },
    ]);
    expect(warnings).toHaveLength(2);
  });

  test('strict mode throws on a fatal diagnostic, naming only the fatal line', () => {
    const ingestor = createSourceIngestor(makeHost({ strict: true }));

    expect(() => ingestor.surfaceDiagnostics([fatal])).toThrow(
      /SOURCE_SVELTE_DEPENDENCY_MISSING src\/Usage\.svelte/
    );
    expect(() => ingestor.surfaceDiagnostics([advisory, fatal])).toThrow(
      /SOURCE_SVELTE_DEPENDENCY_MISSING/
    );
    expect(() => ingestor.surfaceDiagnostics([advisory, fatal])).not.toThrow(
      /SOURCE_NATIVE_PARSE_ERROR/
    );
  });

  test('recovered native parse diagnostics are advisory: warn-only, never strict-fatal, never quarantined', () => {
    const warnings: string[] = [];
    const strict = createSourceIngestor(makeHost({ strict: true, warnings }));

    expect(strict.surfaceDiagnostics([advisory])).toEqual(new Set());
    expect(warnings).toEqual([
      expect.stringContaining('SOURCE_NATIVE_PARSE_ERROR src/app.js'),
    ]);

    const lax = createSourceIngestor(makeHost({ warnings }));
    expect(lax.surfaceDiagnostics([advisory, fatal])).toEqual(
      new Set(['src/Usage.svelte'])
    );
  });
});
