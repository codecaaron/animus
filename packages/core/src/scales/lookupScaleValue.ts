import { Theme } from '@emotion/react';
import { get, isArray, isObject, isString } from 'lodash';

import { compatTheme } from '../compatTheme';
import { Prop } from '../types/config';

export const lookupScaleValue = (
  val: string | number,
  scale: Prop['scale'],
  theme: Theme | undefined
) => {
  if (isArray(scale)) {
    return val;
  }
  if (isObject(scale)) {
    return get(scale, val);
  }
  if (isString(scale)) {
    const usedScale = get(theme, scale, get(compatTheme, scale));
    if (!usedScale) return undefined;
    return isArray(usedScale) ? val : get(usedScale, val);
  }
  return undefined;
};
