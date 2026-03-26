import {
  Globals,
  StandardProperties,
  SvgProperties,
  VendorProperties,
} from 'csstype';

import { CSSObject } from './shared';

type AnimusCSSProperties<Overrides = (string & {}) | 0> =
  StandardProperties<Overrides> &
    VendorProperties<Overrides> &
    Omit<SvgProperties<Overrides>, keyof StandardProperties>;

type ColorProperties = 'color' | `${string}Color` | 'fill' | 'stroke';

type ColorGlobals = {
  [K in Extract<keyof AnimusCSSProperties, ColorProperties>]?:
    | Globals
    | 'currentColor'
    | 'transparent'
    | (string & {});
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
    | (number & {});
};

export interface PropertyTypes<Overrides = (string & {}) | 0>
  extends Omit<
      AnimusCSSProperties<Overrides>,
      keyof ColorGlobals | keyof SizeGlobals
    >,
    ColorGlobals,
    SizeGlobals {
  none?: never;
  variables?: CSSObject;
}
