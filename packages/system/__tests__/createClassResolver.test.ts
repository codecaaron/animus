import { describe, expect, it } from 'vitest';

import { createClassResolver } from '../src/runtime/createClassResolver';

describe('createClassResolver', () => {
  it('returns base class on empty call', () => {
    const resolver = createClassResolver('animus-card-abc', {});
    expect(resolver()).toBe('animus-card-abc');
  });

  it('returns base class when called with empty props', () => {
    const resolver = createClassResolver('animus-card-abc', {});
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
});
