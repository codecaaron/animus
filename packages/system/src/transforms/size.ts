import { createTransform } from './createTransform';

export const percentageOrAbsolute = (coordinate: number) => {
  if (coordinate === 0) {
    return coordinate;
  }
  if (coordinate <= 1 && coordinate >= -1) {
    return `${coordinate * 100}%`;
  }
  return `${coordinate}px`;
};

const valueWithUnit = /(-?\d*\.?\d+)(%|\w*)/;

export const size = createTransform('size', (value) => {
  if (typeof value === 'number') {
    return percentageOrAbsolute(value);
  }

  const strValue = value as string;

  if (strValue.includes('calc')) {
    return strValue;
  }

  const [match, number, unit] = valueWithUnit.exec(strValue) || [];

  if (match === undefined) {
    return strValue;
  }

  const numericValue = parseFloat(number);

  return !unit ? percentageOrAbsolute(numericValue) : `${numericValue}${unit}`;
});
