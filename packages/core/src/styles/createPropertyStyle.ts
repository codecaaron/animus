import { identity, isUndefined } from 'lodash';

import { lookupScaleValue } from '../scales/lookupScaleValue';
import { Prop } from '../types/config';
import { AbstractProps } from '../types/props';
import { CSSObject } from '../types/shared';

export const createPropertyStyle = <Config extends Prop, Value>(
  value: Value,
  props: AbstractProps,
  config: Config
) => {
  const styles: CSSObject = {};
  const {
    transform = identity,
    property,
    properties = [property],
    scale,
    variable,
  } = config;
  const alwaysTransform = scale === undefined || Array.isArray(scale);

  if (isUndefined(value)) {
    return styles;
  }

  let useTransform = false;
  let intermediateValue: string | number | undefined;
  let scaleValue: string | number | undefined;

  switch (typeof value) {
    case 'number':
    case 'string':
      scaleValue = lookupScaleValue(value, scale, props?.theme);
      useTransform = scaleValue !== undefined || alwaysTransform;
      intermediateValue = scaleValue ?? value;
      break;
    case 'function':
      if (props.theme) {
        intermediateValue = value(props.theme) as string | number | undefined;
      }
      break;
    default:
      return styles;
  }

  // for each property look up the scale value from theme if passed and apply any
  // final transforms to the value
  properties.forEach((property) => {
    let styleValue: ReturnType<typeof transform> = intermediateValue;

    if (useTransform && !isUndefined(styleValue)) {
      styleValue = transform(styleValue, property, props);
    }

    switch (typeof styleValue) {
      case 'number':
      case 'string':
        return (styles[property] = styleValue);
      case 'object':
        return Object.assign(styles, styleValue);
      default:
    }
  });

  if (variable) {
    let styleValue: ReturnType<typeof transform> = intermediateValue;
    if (useTransform && !isUndefined(styleValue)) {
      styleValue = transform(styleValue, property, props);
    }
    if (styleValue && typeof styleValue !== 'object') {
      styles[variable] = styleValue;
    }
  }
  // return the resulting styles object
  return styles;
};
