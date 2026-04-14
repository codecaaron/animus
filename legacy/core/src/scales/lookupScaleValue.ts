import { Theme } from '@emotion/react';
import { get, isObject, isString } from 'lodash';

import { compatTheme } from '../compatTheme';
import { Prop } from '../types/config';

export const lookupScaleValue = (
  val: string | number,
  scale: Prop['scale'],
  theme: Theme | undefined
) => {
  const isNegative = typeof val === 'number' && val < 0;
  const lookupVal = isNegative ? Math.abs(val) : val;

  let result: string | number | undefined;

  if (Array.isArray(scale)) {
    result = lookupVal;
  } else if (isObject(scale)) {
    result = get(scale, lookupVal);
  } else if (isString(scale)) {
    const usedScale = get(theme, scale, get(compatTheme, scale));
    if (!usedScale) return undefined;
    result = Array.isArray(usedScale) ? lookupVal : get(usedScale, lookupVal);
  }

  if (isNegative && result !== undefined) {
    return typeof result === 'number' ? -result : `-${result}`;
  }

  return result;
};
