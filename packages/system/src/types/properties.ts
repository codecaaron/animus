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
