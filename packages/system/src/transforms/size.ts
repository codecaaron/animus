import { createTransform } from './createTransform';

/** The transform below cannot reference this: it inlines its own copy. */
export const percentageOrAbsolute = (coordinate: number) => {
  if (coordinate === 0) {
    return coordinate;
  }
  if (coordinate <= 1 && coordinate >= -1) {
    return `${coordinate * 100}%`;
  }
  return `${coordinate}px`;
};

/** All logic stays inline: the extractor cannot follow external references. */
export const size = createTransform('size', (value) => {
  const toSize = (n: number) => {
    if (n === 0) return n;
    if (n <= 1 && n >= -1) return `${n * 100}%`;
    return `${n}px`;
  };

  if (typeof value === 'number') {
    return toSize(value);
  }

  const strValue = value as string;

  if (strValue.includes('calc')) {
    return strValue;
  }

  const [match, number, unit] = /(-?\d*\.?\d+)(%|\w*)/.exec(strValue) || [];

  if (match === undefined) {
    return strValue;
  }

  const numericValue = parseFloat(number);

  return !unit ? toSize(numericValue) : `${numericValue}${unit}`;
});
