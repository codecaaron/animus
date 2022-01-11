import { Theme } from '@emotion/react';
import { get, isArray, isObject, isString } from 'lodash';

import { Prop } from '../types/config';

export const scaleLookup = (
  val: string | number,
  scale: Prop['scale'],
  theme: Theme | undefined
) => {
  if (isString(scale)) {
    return get(theme, [scale, val]);
  }
  if (isArray(scale)) {
    return val;
  }
  if (isObject(scale)) {
    return get(scale, val);
  }
  return undefined;
};
