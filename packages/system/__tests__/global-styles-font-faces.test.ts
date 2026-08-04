import { describe, expect, it } from 'vitest';

import { createGlobalStyles } from './test-system';

/**
 * ani-ledger-closeout: typed @font-face resources (global-styles-system).
 * The factory carries descriptors on the block; the loader serializes them
 * and the extractor renders them ahead of selector rules — those halves are
 * pinned in Rust (theme.rs font_face tests). Here: the authoring surface.
 */
describe('createGlobalStyles fontFaces', () => {
  it('carries typed descriptors on the block', () => {
    const block = createGlobalStyles(
      { body: { m: 0 } },
      {
        fontFaces: [
          {
            family: 'Inter',
            src: [{ url: '/fonts/inter.woff2', format: 'woff2' }],
            weight: '100 900',
            display: 'swap',
          },
        ],
      }
    );

    expect(block.__brand).toBe('GlobalStyleBlock');
    expect(block.fontFaces).toEqual([
      {
        family: 'Inter',
        src: [{ url: '/fonts/inter.woff2', format: 'woff2' }],
        weight: '100 900',
        display: 'swap',
      },
    ]);
  });

  it('omits the field entirely without descriptors (byte-identical legacy blocks)', () => {
    expect('fontFaces' in createGlobalStyles({ body: { m: 0 } })).toBe(false);
    expect(
      'fontFaces' in createGlobalStyles({ body: { m: 0 } }, { fontFaces: [] })
    ).toBe(false);
  });

  it('copies the descriptor array so later caller mutation cannot leak in', () => {
    const authored = [
      { family: 'Inter', src: [{ url: '/fonts/inter.woff2' }] },
    ];
    const block = createGlobalStyles(
      { body: { m: 0 } },
      { fontFaces: authored }
    );
    authored.push({ family: 'Mono', src: [{ url: '/fonts/mono.woff2' }] });

    expect(block.fontFaces).toHaveLength(1);
  });
});
