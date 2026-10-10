import { describe, expect, it } from 'vitest';

import { createClassResolver } from '../src/runtime/createClassResolver';

describe('createClassResolver', () => {
  it('returns base class for both call forms on an empty config', () => {
    const resolver = createClassResolver('animus-card-abc', {});
    // Omitted props and `{}` must agree — the `props || {}` guard is the only
    // difference between the two call forms.
    expect(resolver()).toBe('animus-card-abc');
    expect(resolver({})).toBe('animus-card-abc');
  });

  it('resolves variant prop to correct class', () => {
    const resolver = createClassResolver('animus-btn-abc', {
      variants: {
        size: { options: ['sm', 'lg'], default: undefined },
      },
    });
    expect(resolver({ size: 'lg' })).toBe(
      'animus-btn-abc animus-btn-abc--size-lg'
    );
  });

  it('applies default variant when prop omitted', () => {
    const resolver = createClassResolver('animus-btn-abc', {
      variants: {
        size: { options: ['sm', 'lg'], default: 'md' },
      },
    });
    expect(resolver()).toBe('animus-btn-abc animus-btn-abc--size-default');
    expect(resolver({})).toBe('animus-btn-abc animus-btn-abc--size-default');
  });

  it('toggles state class on boolean true', () => {
    const resolver = createClassResolver('animus-panel-abc', {
      states: ['loading', 'disabled'],
    });
    expect(resolver({ loading: true })).toBe(
      'animus-panel-abc animus-panel-abc--loading'
    );
    expect(resolver({ loading: true, disabled: true })).toBe(
      'animus-panel-abc animus-panel-abc--loading animus-panel-abc--disabled'
    );
  });

  it('does not include state class when false', () => {
    const resolver = createClassResolver('animus-panel-abc', {
      states: ['loading'],
    });
    expect(resolver({ loading: false })).toBe('animus-panel-abc');
    expect(resolver({})).toBe('animus-panel-abc');
  });

  it('matches compound conditions', () => {
    const resolver = createClassResolver('animus-btn-abc', {
      variants: {
        size: { options: ['sm', 'lg'] },
        variant: { options: ['ghost', 'solid'] },
      },
      compounds: [
        {
          conditions: { size: 'sm', variant: 'ghost' },
          className: 'animus-btn-abc--compound-0',
        },
      ],
    });
    expect(resolver({ size: 'sm', variant: 'ghost' })).toContain(
      'animus-btn-abc--compound-0'
    );
    expect(resolver({ size: 'lg', variant: 'ghost' })).not.toContain(
      'animus-btn-abc--compound-0'
    );
  });

  it('matches compound with array conditions', () => {
    const resolver = createClassResolver('animus-btn-abc', {
      variants: {
        variant: { options: ['ghost', 'subtle', 'solid'] },
      },
      compounds: [
        {
          conditions: { variant: ['ghost', 'subtle'] },
          className: 'animus-btn-abc--compound-0',
        },
      ],
    });
    expect(resolver({ variant: 'ghost' })).toContain(
      'animus-btn-abc--compound-0'
    );
    expect(resolver({ variant: 'subtle' })).toContain(
      'animus-btn-abc--compound-0'
    );
    expect(resolver({ variant: 'solid' })).not.toContain(
      'animus-btn-abc--compound-0'
    );
  });

  it('resolves system prop from shared map', () => {
    const systemPropMap = {
      p: { '8': 'animus-u-p8' },
    };
    const resolver = createClassResolver(
      'animus-box-abc',
      { systemPropNames: ['p'] },
      systemPropMap
    );
    expect(resolver({ p: 8 })).toBe('animus-box-abc animus-u-p8');
  });

  it('treats an explicit undefined prop as omitted', () => {
    const resolver = createClassResolver(
      'animus-btn-abc',
      {
        variants: { size: { options: ['sm', 'md'], default: 'md' } },
        compounds: [
          {
            conditions: { size: 'md' },
            className: 'animus-btn-abc--compound-0',
          },
        ],
        states: ['busy'],
        systemPropNames: ['p', 'm'],
      },
      { p: { '_:8': 'animus-u-p8' } },
      { m: { varName: '--animus-m', slotClass: 'animus-dyn-m' } }
    );
    // A variant default stays the `-default` marker, which lets a compose
    // parent's shared value win; a breakpoint left undefined keeps the
    // static class of the value without it.
    expect(
      resolver.attrs({
        size: undefined,
        busy: undefined,
        m: undefined,
        p: { _: 8, sm: undefined },
      })
    ).toEqual(resolver.attrs({ p: { _: 8 } }));
  });

  it('combines all resolution types', () => {
    const systemPropMap = {
      p: { '8': 'animus-u-p8' },
    };
    const resolver = createClassResolver(
      'animus-widget-abc',
      {
        variants: {
          variant: { options: ['ghost'], default: undefined },
        },
        states: ['loading'],
        compounds: [
          {
            conditions: { variant: 'ghost' },
            className: 'animus-widget-abc--compound-0',
          },
        ],
        systemPropNames: ['p'],
      },
      systemPropMap
    );
    const result = resolver({ variant: 'ghost', loading: true, p: 8 });
    expect(result).toContain('animus-widget-abc');
    expect(result).toContain('animus-widget-abc--variant-ghost');
    expect(result).toContain('animus-widget-abc--compound-0');
    expect(result).toContain('animus-widget-abc--loading');
    expect(result).toContain('animus-u-p8');
  });

  it('returns spreadable attributes with static, default, state, and system classes', () => {
    const resolver = createClassResolver(
      'animus-widget-abc',
      {
        variants: {
          size: { options: ['sm', 'lg'], default: 'sm' },
        },
        states: ['loading'],
        systemPropNames: ['p'],
      },
      { p: { '8': 'animus-u-p8' } }
    );

    expect(resolver.attrs({ loading: true, p: 8 })).toEqual({
      class:
        'animus-widget-abc animus-widget-abc--size-default animus-widget-abc--loading animus-u-p8',
    });
  });

  it('serializes dynamic CSS-variable styles in resolution order', () => {
    const resolver = createClassResolver(
      'animus-box-abc',
      { systemPropNames: ['p', 'm'] },
      undefined,
      {
        p: {
          varName: '--animus-p',
          slotClass: 'animus-dyn-p',
          property: 'padding',
        },
        m: {
          varName: '--animus-m',
          slotClass: 'animus-dyn-m',
          property: 'margin',
        },
      }
    );

    expect(resolver.attrs({ m: '4px', p: '13px' })).toEqual({
      class: 'animus-box-abc animus-dyn-p animus-dyn-m',
      style: '--animus-p: 13px; --animus-m: 4px',
    });
  });

  it("returns React-named props, joining the caller's className and style", () => {
    const resolver = createClassResolver(
      'animus-text-abc',
      { systemPropNames: ['p', 'lineClamp'] },
      undefined,
      {
        p: {
          varName: '--animus-p',
          slotClass: 'animus-dyn-p',
          property: 'padding',
        },
        lineClamp: {
          varName: '--animus-line-clamp_Text_abc',
          slotClass: 'animus-dyn-line-clamp_Text_abc',
          property: 'WebkitLineClamp',
        },
      }
    );
    const classes =
      'animus-text-abc animus-dyn-p animus-dyn-line-clamp_Text_abc';

    expect(resolver.props({ p: '13px', lineClamp: 2 })).toEqual({
      className: classes,
      style: { '--animus-p': '13px', '--animus-line-clamp_Text_abc': '2' },
    });
    expect(
      resolver.props({
        p: '13px',
        lineClamp: 2,
        className: 'caller',
        style: { '--animus-p': '1px', color: 'red' },
      })
    ).toEqual({
      className: `${classes} caller`,
      style: {
        '--animus-p': '1px',
        '--animus-line-clamp_Text_abc': '2',
        color: 'red',
      },
    });
    expect(resolver.props({ style: {} })).toEqual({
      className: 'animus-text-abc',
    });
  });

  it('omits style when no dynamic CSS variables are resolved', () => {
    const resolver = createClassResolver('animus-card-abc', {});
    const dynamicResolver = createClassResolver(
      'animus-box-abc',
      { systemPropNames: ['p'] },
      undefined,
      {
        p: {
          varName: '--animus-p',
          slotClass: 'animus-dyn-p',
        },
      }
    );

    expect(resolver.attrs()).toEqual({ class: 'animus-card-abc' });
    expect(resolver.attrs()).not.toHaveProperty('style');
    expect(dynamicResolver.attrs({ p: { _: null, md: undefined } })).toEqual({
      class: 'animus-box-abc',
    });
  });
});
