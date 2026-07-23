// System builder — the primary API

// Builder chain
export { Animus, AnimusWithAll } from './Animus';
export { AnimusExtended, AnimusExtendedWithAll } from './AnimusExtended';
// Slot composition — compose() is RSC-safe (no hooks, no createContext).
// For context-based propagation, import composeWithContext from
// '@animus-ui/system/compose-with-context' (client-only, not re-exported here).
export { compose } from './compose';
// Keyframes primitive — types for annotating return values; factory is `createKeyframes` on build() return
export type { KeyframeFrameMap, KeyframeRef, Keyframes } from './keyframes';
// Runtime shims (extracted component + class resolver + composed family factories)
export { createComponent } from './runtime';
export { createClassResolver } from './runtime/createClassResolver';
export { createComposedFamily } from './runtime/createComposedFamily';
export type {
  CreateKeyframesFactory,
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
// Condition aliases — runtime registry + augmentable authoring type surface
export {
  BUILT_IN_CONDITIONS,
  type ConditionAlias,
  type ConditionAliasMap,
  type ConditionKind,
  type Conditions,
  type ConditionsOf,
  type RawAtRuleKey,
  type RegistryBrand,
  type SelectorsOf,
  type UnknownAtRule,
  type UnknownConditionAlias,
} from './conditions.js';
// Selector aliases
export {
  BUILT_IN_SELECTORS,
  type SelectorAlias,
  type SelectorAliasMap,
  type Selectors,
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
  BuiltInConditionAlias,
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
  ContextualVarRegistration,
  CSSColorValue,
  EmittedScales,
  EmittedTokenPaths,
  ScaleTokenRef,
  SerializedTheme,
  Theme,
  ThemeManifest,
  TokenScales,
} from './types/theme';
