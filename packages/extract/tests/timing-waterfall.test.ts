import { describe, expect, test } from 'vitest';

import {
  formatRustTimingWaterfall,
  RUST_TIMING_PHASES,
} from '../pipeline/timing-waterfall';

describe('formatRustTimingWaterfall', () => {
  test('emits one line per phase with the file/cache suffix on parse+walk', () => {
    const lines = formatRustTimingWaterfall(
      { parseAndWalk: 12, cssGeneration: 3, fileCount: 7, cacheHits: 2 },
      { indent: '  ', labelWidth: 13 }
    );
    expect(lines).toHaveLength(RUST_TIMING_PHASES.length);
    expect(lines[0]).toBe('  parse+walk      12ms  (7 files, 2 cached)');
    expect(lines[lines.length - 2]).toBe('  css-gen          3ms');
    // Missing phases render as 0ms rather than being dropped
    expect(lines[1]).toBe('  imports          0ms');
  });

  test('honors the caller column layout (vite: indent 9, width 15)', () => {
    const lines = formatRustTimingWaterfall(
      { parseAndWalk: 5 },
      { indent: '         ', labelWidth: 15 }
    );
    expect(lines[0]).toBe(
      '         parse+walk         5ms  (0 files, 0 cached)'
    );
  });
});
