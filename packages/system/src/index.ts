// System builder — the primary API

// Builder chain
export { Animus, AnimusWithAll } from './Animus';
export { AnimusExtended, AnimusExtendedWithAll } from './AnimusExtended';
// Slot composition
export { compose } from './compose';
// Runtime shims (extracted component + class resolver factories)
export { createComponent } from './runtime';
export { createClassResolver } from './runtime/createClassResolver';
export type {
  GlobalStyleBlock,
  GlobalStyleMap,
  GlobalStylesFactory,
  SerializedConfig,
  SystemInstance,
} from './SystemBuilder';
export { createSystem, SystemBuilder } from './SystemBuilder';
// Scales
export {
  createScale,
  numericOrStringScale,
  numericScale,
  stringScale,
} from './scales/createScale';
// Selector aliases
export {
  BUILT_IN_SELECTORS,
  type SelectorAlias,
  type SelectorAliasMap,
} from './selectors';
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
export { createTheme, ThemeBuilder } from './theme';
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
  AnyBrandedComponent,
  ComposedFamily,
  SharedConfig,
  VariantPropsOf,
} from './types/component';
export type {
  AbstractParser,
  BuiltInSelectorAlias,
  CompoundEntry,
  CSSPropMap,
  CSSProps,
  CustomPropConfig,
  Parser,
  ParserProps,
  Prop,
  PropertyValues,
  Scale,
  ScaleValue,
  SelectorAliasProps,
  SystemProps,
  ThemedCSSPropMap,
  ThemedCSSProps,
  ThemedScale,
  ThemedScaleValue,
  VariantConfig,
} from './types/config';
export type {
  AbstractProps,
  MediaQueryMap,
  ResponsiveProp,
  ThemeProps,
} from './types/props';
export type { ArrayScale, MapScale } from './types/scales';
export type { CSSObject } from './types/shared';
// Types
export type {
  AbstractTheme,
  BaseTheme,
  ColorTokenRef,
  CSSColorValue,
  EmittedScales,
  EmittedTokenPaths,
  ScaleTokenRef,
  SerializedTheme,
  Theme,
  ThemeManifest,
  TokenScales,
} from './types/theme';
