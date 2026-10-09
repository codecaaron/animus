import { describe, expect, it } from 'vitest';

import { createClassResolver } from '../src/runtime/createClassResolver';

// Through the inline variable a keyword would act on `--animus-p`, so
// `inherit` would take the parent's variable, not the parent's padding.
// Extraction gives every runtime-delivered prop one class per keyword, at the
// base and at each breakpoint, keyed the way a static write of it is.
const slot = {
  p: {
    varName: '--animus-p',
    slotClass: 'animus-dyn-p',
    property: 'padding',
  },
};
const keywordClasses = {
  inherit: 'animus-u-inherit',
  'md:initial': 'animus-u-md-initial',
  'sm:revert-layer': 'animus-u-sm-revert-layer',
};

describe('runtime CSS-wide keyword values', () => {
  it('select the keyword class instead of the inline variable', () => {
    const resolver = createClassResolver(
      'animus-box-abc',
      { systemPropNames: ['p'] },
      { p: keywordClasses },
      slot
    );

    expect(resolver.attrs({ p: 'inherit' })).toEqual({
      class: 'animus-box-abc animus-u-inherit',
    });
  });

  it('select each breakpoint keyword class in a responsive value', () => {
    const resolver = createClassResolver(
      'animus-box-abc',
      { systemPropNames: ['p'] },
      { p: keywordClasses },
      slot
    );

    expect(
      resolver.attrs({ p: { _: 'inherit', sm: '13px', md: 'initial' } })
    ).toEqual({
      class:
        'animus-box-abc animus-u-inherit animus-dyn-p-sm animus-u-md-initial',
      style: '--animus-p-sm: 13px',
    });
    expect(resolver.attrs({ p: { _: '2px', sm: 'revert-layer' } })).toEqual({
      class: 'animus-box-abc animus-dyn-p animus-u-sm-revert-layer',
      style: '--animus-p: 2px',
    });
  });

  it('use typed keys for a prop whose static keys are typed', () => {
    const resolver = createClassResolver(
      'animus-box-abc',
      {
        systemPropNames: ['w'],
        customPropMap: {
          w: {
            '"inherit"': 'animus-uc-inherit',
            '{"md":"unset"}': 'animus-uc-md-unset',
          },
        },
        customDynamicConfig: {
          w: {
            varName: '--animus-w',
            slotClass: 'animus-dyn-abc-w',
            property: 'width',
          },
        },
        typedCustomProps: ['w'],
      },
      undefined,
      undefined
    );

    expect(resolver.attrs({ w: { _: 'inherit', md: 'unset' } })).toEqual({
      class: 'animus-box-abc animus-uc-inherit animus-uc-md-unset',
    });
  });

  it('keep the inline variable when the build emitted no keyword class', () => {
    const resolver = createClassResolver(
      'animus-box-abc',
      { systemPropNames: ['p'] },
      { p: {} },
      slot
    );

    expect(resolver.attrs({ p: { _: 'inherit', md: 'initial' } })).toEqual({
      class: 'animus-box-abc animus-dyn-p animus-dyn-p-md',
      style: '--animus-p: inherit; --animus-p-md: initial',
    });
    // A keyword skips the prop's transform, as a static write does.
    const transformed = createClassResolver(
      'animus-box-abc',
      { systemPropNames: ['p'] },
      { p: {} },
      { p: { ...slot.p, transform: (value: string | number) => `${value}px` } }
    );
    expect(transformed.attrs({ p: { _: 'unset', md: 4 } })).toEqual({
      class: 'animus-box-abc animus-dyn-p animus-dyn-p-md',
      style: '--animus-p: unset; --animus-p-md: 4px',
    });
  });
});
