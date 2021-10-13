import { identity, isArray, isUndefined } from 'lodash';
import { Prop, PropTransformer } from '../types/config';
import { createScaleLookup } from '../scales/createScaleLookup';
import { CSSObject } from '..';

export function createTransform<P extends string, Config extends Prop>(
  prop: P,
  config: Config
): PropTransformer<P, Config> {
  const {
    transform = identity,
    property,
    properties = [property],
    scale,
  } = config;
  const getScaleValue = createScaleLookup(scale);
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
          scaleValue = getScaleValue(value, props);
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
      // return the resulting styles object
      return styles;
    },
  };
}
