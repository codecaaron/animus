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

  // Only a lone scalar converts; any other string is preserved as authored.
  const [match, number, unit] =
    /^\s*([+-]?\d*\.?\d+)(?:\.|(%|\w*))\s*$/.exec(strValue) || [];

  if (match === undefined) {
    return strValue;
  }

  const numericValue = parseFloat(number);

  return !unit ? toSize(numericValue) : `${numericValue}${unit}`;
});
