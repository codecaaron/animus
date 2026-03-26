// System builder — the primary API

// Builder chain
export { Animus, AnimusWithAll } from './Animus';
export { AnimusExtended, AnimusExtendedWithAll } from './AnimusExtended';
// Property builder
export { PropertyBuilder } from './PropertyBuilder';
export type { SerializedConfig, SystemInstance } from './SystemBuilder';
export { createSystem, SystemBuilder } from './SystemBuilder';
// Scales
export {
  createScale,
  numericOrStringScale,
  numericScale,
  stringScale,
} from './scales/createScale';
export type {
  Assign,
  AssignValueIfUnmergable,
  ColorModeConfig,
  FindPath,
  KeyAsVariable,
  LiteralPaths,
  Mergable,
  Merge,
  MergeTheme,
  Path,
  PathToLiteral,
  PathValue,
  PrivateThemeKeys,
  SanitizeKey,
} from './theme';
// Theme builder
export {
  createTheme,
  flattenScale,
  serializeTokens,
  ThemeBuilder,
} from './theme';
export { borderShorthand } from './transforms/border';
// Transforms
export {
  createTransform,
  type NamedTransform,
  type TransformFn,
} from './transforms/createTransform';
export { gridItem, gridItemRatio } from './transforms/grid';
export { percentageOrAbsolute, size } from './transforms/size';
// Component types (needed for portable declaration emit — TS2742)
export type {
  AnimusComponent,
  AnimusWrappedComponent,
} from './types/component';
export type {
  AbstractParser,
  CSSPropMap,
  CSSProps,
  Parser,
  ParserProps,
  Prop,
  PropertyValues,
  Scale,
  ScaleValue,
  SystemProps,
  ThemedCSSPropMap,
  ThemedCSSProps,
  ThemedScale,
  ThemedScaleValue,
  VariantConfig,
} from './types/config';
export type {
  AbstractProps,
  MediaQueryArray,
  MediaQueryMap,
  ResponsiveProp,
  ThemeProps,
} from './types/props';
export type { ArrayScale, MapScale } from './types/scales';
export type { CSSObject, NarrowPrimitive } from './types/shared';
// Types
export type {
  AbstractTheme,
  BaseTheme,
  Breakpoints,
  Theme,
  TokenScales,
} from './types/theme';
