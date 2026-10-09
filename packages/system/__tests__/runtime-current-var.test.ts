import { describe, expect, it } from 'vitest';

import { createClassResolver } from '../src/runtime/createClassResolver';

// A prop with `currentVar` writes it from its slot as a static write does,
// except for a value that reads the variable itself: that write would make
// the variable cyclic, so such a value takes the slot that leaves it alone.
const bg = {
  varName: '--animus-bg',
  slotClass: 'animus-dyn-bg',
  property: 'backgroundColor',
  currentVar: '--current-bg',
  scaleValues: { 'current-bg': 'var(--current-bg)' },
};

const resolve = (
  props: { bg: string | Record<string, string> },
  config: Omit<typeof bg, 'currentVar'> & { currentVar?: string } = bg
) =>
  createClassResolver(
    'animus-box-abc',
    { systemPropNames: ['bg'] },
    undefined,
    { bg: config }
  ).attrs(props);

describe('a runtime value of a prop with currentVar', () => {
  // The same resolved values pin the extractor's static predicate.
  it.each([
    ['var(--current-bg)', false], // 'current-bg'
    ['color-mix(in srgb, var(--current-bg) 85%, transparent)', false], // '{colors.current-bg/85}'
    ['var(--current-bg, red)', false],
    ['var(--current-bg,red)', false],
    ['var( --current-bg )', false],
    ['VAR(--current-bg)', false],
    ['Var(\n  --current-bg ,red)', false],
    ['var(--current-bg /* c */)', false],
    ['var(/* c */ --current-bg\t,\fred)', false],
    ['var(\ufeff--current-bg)', true],
    ['var(--current-bg\u0085)', true],
    ['var(--color-ink)', true], // 'ink'
    ['#0af', true],
    ['var(--current-bg-alt)', true],
  ])('%s writes currentVar: %s', (resolved, writes) => {
    expect(resolve({ bg: resolved })).toEqual({
      class: `animus-box-abc ${writes ? 'animus-dyn-bg' : 'animus-dyn-bg--keep'}`,
      style: `--animus-bg: ${resolved}`,
    });
  });

  it('reads its own currentVar through the scale and keeps it at that breakpoint', () => {
    expect(resolve({ bg: { _: 'current-bg', md: '#0af' } })).toEqual({
      class: 'animus-box-abc animus-dyn-bg--keep animus-dyn-bg-md',
      style: '--animus-bg: var(--current-bg); --animus-bg-md: #0af',
    });
    expect(resolve({ bg: { _: '#0af', md: 'current-bg' } })).toEqual({
      class: 'animus-box-abc animus-dyn-bg animus-dyn-bg--keep-md',
      style: '--animus-bg: #0af; --animus-bg-md: var(--current-bg)',
    });
  });

  it('keeps the plain slot for a prop without currentVar', () => {
    const { currentVar: _, ...plain } = bg;
    expect(resolve({ bg: 'current-bg' }, plain)).toEqual({
      class: 'animus-box-abc animus-dyn-bg',
      style: '--animus-bg: var(--current-bg)',
    });
  });
});
