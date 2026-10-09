import {
  Globals,
  ObsoleteProperties,
  StandardProperties,
  SvgProperties,
  VendorProperties,
} from 'csstype';

/** CSS Borders 4's `corner-shape`, which the pinned csstype predates. */
type BordersLevel4Properties = {
  // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- the CSS property name
  cornerShape?:
    | Globals
    | 'bevel'
    | 'notch'
    | 'round'
    | 'scoop'
    | 'square'
    | 'squircle'
    | `superellipse(${string})`
    | (string & {});
};

type AnimusCSSProperties<Overrides = (string & {}) | 0> =
  StandardProperties<Overrides> &
    VendorProperties<Overrides> &
    // Required by legacy line clamping despite csstype classifying it as obsolete.
    Pick<ObsoleteProperties<Overrides>, 'WebkitBoxOrient'> &
    Omit<SvgProperties<Overrides>, keyof StandardProperties> &
    BordersLevel4Properties;

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
  | `${string}${'Width' | 'Height'}`
  | 'inlineSize'
  | 'blockSize'
  | `${string}${'InlineSize' | 'BlockSize'}`
  | `inset${'Inline' | 'Block'}${'' | 'Start' | 'End'}`;

type SizeValues =
  | `${number}${'px' | 'rem' | 'vh' | 'vw' | 'vmax' | 'vmin' | '%'}`
  | `calc(${any})`;

type SizeGlobals = {
  [K in Extract<keyof AnimusCSSProperties, SizeProperties>]?:
    | AnimusCSSProperties[K]
    | SizeValues
    | (number & {});
};

/**
 * A non-strict `fontSize` takes a number, as the size properties do; a strict
 * one (`Overrides` of `never`) keeps to its scale.
 */
type FontSizeGlobals<Overrides> = {
  fontSize?:
    | AnimusCSSProperties<Overrides>['fontSize']
    | ([Overrides] extends [never] ? never : number & {});
};

export interface PropertyTypes<Overrides = (string & {}) | 0>
  extends
    Omit<
      AnimusCSSProperties<Overrides>,
      keyof ColorGlobals | keyof SizeGlobals | 'fontSize'
    >,
    ColorGlobals,
    SizeGlobals,
    FontSizeGlobals<Overrides> {
  none?: never;
  [key: `--${string}`]: (string & {}) | number | undefined;
}
