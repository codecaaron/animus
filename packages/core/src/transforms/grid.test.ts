import {
  gridItem,
  gridItemRatio,
  parseGridRatio,
  repeatGridItem,
} from './grid';

describe(gridItem, () => {
  it.each([
    ['max', 'minmax(0, max-content)'],
    ['min', 'minmax(0, min-content)'],
    ['1', 'minmax(0, 1fr)'],
    ['2', 'minmax(0, 2fr)'],
    ['500', 'minmax(0, 500fr)'],
    ['500px', 'minmax(0, 500px)'],
  ])('gridItem(%s)', (input: string, expected: string) => {
    expect(gridItem(input)).toBe(expected);
  });
});

describe(repeatGridItem, () => {
  it.each([
    ['max', 1, 'minmax(0, max-content)'],
    ['min', 2, 'repeat(2, minmax(0, min-content))'],
    ['1', 2, 'repeat(2, minmax(0, 1fr))'],
    ['50px', 30, 'repeat(30, minmax(0, 50px))'],
  ])(
    'repeatGridItem(%s, %i)',
    (input: string, count: number, expected: string) => {
      expect(repeatGridItem(input, count)).toBe(expected);
    }
  );
});

describe(parseGridRatio, () => {
  it.each([
    ['1:1', 'repeat(2, minmax(0, 1fr))'],
    ['1:1:max', 'repeat(2, minmax(0, 1fr)) minmax(0, max-content)'],
    [
      'max:max:1:1:min:min:50px:50px:5px',
      'repeat(2, minmax(0, max-content)) repeat(2, minmax(0, 1fr)) repeat(2, minmax(0, min-content)) repeat(2, minmax(0, 50px)) minmax(0, 5px)',
    ],
  ])('parseGridRatio(%s)', (input: string, expected: string) => {
    expect(parseGridRatio(input)).toBe(expected);
  });
});
describe(gridItemRatio, () => {
  it.each([
    ['1:1', 'repeat(2, minmax(0, 1fr))'],
    ['1:1:max', 'repeat(2, minmax(0, 1fr)) minmax(0, max-content)'],
    [3, 'repeat(3, minmax(0, 1fr))'],
    [12, 'repeat(12, minmax(0, 1fr))'],
    [
      'max:max:1:1:min:min',
      'repeat(2, minmax(0, max-content)) repeat(2, minmax(0, 1fr)) repeat(2, minmax(0, min-content))',
    ],
  ])('gridItemRatio(%s)', (input: string | number, expected: string) => {
    expect(gridItemRatio(input)).toBe(expected);
  });
});
