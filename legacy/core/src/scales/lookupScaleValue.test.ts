import { lookupScaleValue } from './lookupScaleValue';

describe('lookupScaleValue', () => {
  const theme = {
    space: {
      0: '0',
      4: '0.25rem',
      8: '0.5rem',
      16: '1rem',
    },
  };

  it('resolves positive scale value', () => {
    expect(lookupScaleValue(8, 'space', theme as any)).toBe('0.5rem');
  });

  it('resolves negative scale value by abs lookup + negate', () => {
    expect(lookupScaleValue(-8, 'space', theme as any)).toBe('-0.5rem');
  });

  it('resolves negative zero as positive zero', () => {
    expect(lookupScaleValue(0, 'space', theme as any)).toBe('0');
  });

  it('returns undefined for unresolvable negative value', () => {
    expect(lookupScaleValue(-99, 'space', theme as any)).toBeUndefined();
  });

  it('resolves negative with numeric scale value', () => {
    const numericTheme = { space: { 4: 16 } };
    expect(lookupScaleValue(-4, 'space', numericTheme as any)).toBe(-16);
  });

  it('passes through positive value with no scale', () => {
    expect(lookupScaleValue(8, undefined, undefined)).toBeUndefined();
  });

  it('handles inline object scale with negative lookup', () => {
    const inlineScale = { 4: '1rem', 8: '2rem' };
    expect(lookupScaleValue(-4, inlineScale as any, undefined)).toBe('-1rem');
  });
});
