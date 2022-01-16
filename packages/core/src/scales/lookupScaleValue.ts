import { Theme } from '@emotion/react';
import { get, isArray, isObject, isString } from 'lodash';
import { compatTheme } from '../compatTheme';

import { Prop } from '../types/config';

export const lookupScaleValue = (
  val: string | number,
  scale: Prop['scale'],
  theme: Theme | undefined
) => {
  if (isString(scale) && theme?.hasOwnProperty(scale)) {
    return get(theme, [scale, val]);
  }
  if (isString(scale) && compatTheme?.hasOwnProperty(scale)) {
    return get(compatTheme, [scale, val]);
  }
  if (isArray(scale)) {
    return val;
  }
  if (isObject(scale)) {
    return get(scale, val);
  }
  return undefined;
};
