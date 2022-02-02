import { identity, isArray, isUndefined } from 'lodash';

import { lookupScaleValue } from '../scales/lookupScaleValue';
import { CSSObject } from '../types/shared';
import { Prop, PropTransformer } from './config';

export function createTransform<P extends string, Config extends Prop>(
  prop: P,
  config: Config
): PropTransformer<P, Config> {
  const {
    transform = identity,
    property,
    properties = [property],
    scale,
    variable,
  } = config;
  const alwaysTransform = scale === undefined || isArray(scale);

  return {
    ...config,
    prop,
    styleFn: (value, prop, props) => {
      const styles: CSSObject = {};

      if (isUndefined(value)) {
        return styles;
      }

      let useTransform = false;
      let intermediateValue: string | number | undefined;
      let scaleValue: string | number | undefined;

      switch (typeof value) {
        case 'number':
        case 'string':
          scaleValue = lookupScaleValue(value, scale as [], props.theme);
          useTransform = scaleValue !== undefined || alwaysTransform;
          intermediateValue = scaleValue ?? value;
          break;
        case 'function':
          if (props.theme) {
            intermediateValue = value(props.theme) as
              | string
              | number
              | undefined;
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
    },
  };
}
