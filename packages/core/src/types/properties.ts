import {
  Globals,
  StandardProperties,
  SvgProperties,
  VendorProperties,
} from 'csstype';

import { CSSObject, NarrowPrimitive } from './shared';

type AnimusCSSProperties<Overrides = DefaultCSSPropertyValue> =
  StandardProperties<Overrides> &
    VendorProperties<Overrides> &
    Omit<SvgProperties<Overrides>, keyof StandardProperties>;

type ColorProperties = 'color' | `${string}Color` | 'fill' | 'stroke';

type ColorGlobals = {
  [K in Extract<keyof AnimusCSSProperties, ColorProperties>]?:
    | Globals
    | 'currentColor'
    | 'transparent'
    | NarrowPrimitive<string>;
};

type SizeProperties =
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'inset'
  | 'width'
  | 'height'
  | `${string}${'Width' | 'Height'}`;

type SizeValues =
  | `${number}${'px' | 'rem' | 'vh' | 'vw' | 'vmax' | 'vmin' | '%'}`
  | `calc(${any})`;

type SizeGlobals = {
  [K in Extract<keyof AnimusCSSProperties, SizeProperties>]?:
    | AnimusCSSProperties[K]
    | SizeValues
    | NarrowPrimitive<number>;
};

/** This is a placeholder type for CSS properties that may not have any specific global values (outlineOffset).
 * (string & {}) will allow strings but not generalize the union type to just a string if other string literals exist in the union.
 *
 * This ensures that autosuggestions will still work for literal types but still allow any string for certain properties.
 */
export type DefaultCSSPropertyValue = (string & {}) | 0;

export interface PropertyTypes<Overrides = DefaultCSSPropertyValue>
  extends Omit<
      AnimusCSSProperties<Overrides>,
      keyof ColorGlobals | keyof SizeGlobals
    >,
    ColorGlobals,
    SizeGlobals {
  none?: never;
  variables?: CSSObject;
}
