export { Animus, AnimusWithAll } from './Animus';
export { AnimusExtended, AnimusExtendedWithAll } from './AnimusExtended';
// `composeWithContext` stays out of this barrel: it is client-only and ships
// from '@animus-ui/system/compose-with-context'.
export { compose } from './compose';
export type { KeyframeFrameMap, KeyframeRef, Keyframes } from './keyframes';
export { asset, ASSET_PLACEHOLDER_PREFIX, type AssetRef } from './asset.js';
export { createComponent } from './runtime';
export {
  type ClassResolver,
  type ClassResolverAttributes,
  createClassResolver,
} from './runtime/createClassResolver';
export { createComposedFamily } from './runtime/createComposedFamily';
export type {
  CreateKeyframesFactory,
  FontFace,
  FontFaceSrc,
  GlobalStyleBlock,
  GlobalStyleMap,
  GlobalStylesFactory,
  KeyframesFrameData,
  LibraryBundle,
  RegisterableGlobalStyles,
  RegisterableKeyframes,
  RegistrySnapshot,
  SealedSystemInstance,
  SerializedConfig,
  SystemBuilderStage,
  SystemBundle,
  SystemInstance,
  VocabularyCollisionEntry,
  VocabularyGlobalStyleEntry,
  VocabularyKeyframesEntry,
  VocabularyLegacyVerbEntry,
  VocabularyNameCollision,
  VocabularyOf,
  VocabularyRecord,
} from './SystemBuilder';
export { createSystem, SystemBuilder } from './SystemBuilder';
export {
  createScale,
  numericOrStringScale,
  numericScale,
  stringScale,
} from './scales/createScale';
export {
  type AtRuleValue,
  BUILT_IN_CONDITIONS,
  type ConditionAlias,
  type ConditionAliasMap,
  type ConditionKind,
  type Conditions,
  type ConditionsOf,
  type NarrowedAliases,
  type RawAtRuleKey,
  type RegistryBrand,
  type ReservedByConditionRegistry,
  type ReservedBySelectorRegistry,
  type SelectorsOf,
  type UnknownAtRule,
  type UnknownConditionAlias,
} from './conditions.js';
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
export {
  createTheme,
  type Flatten,
  ThemeBuilder,
  type ThemeBuilderStage,
} from './theme';
export { borderShorthand } from './transforms/border';
export {
  areTransformsEqual,
  createTransform,
  type NamedTransform,
  type TransformFn,
} from './transforms/createTransform';
export { gridItem, gridItemRatio } from './transforms/grid';
export { percentageOrAbsolute, size } from './transforms/size';
// Re-exported so consumer declaration emit stays portable (TS2742).
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
export type {
  AbstractTheme,
  BaseTheme,
  BrowserColorSchemeConfig,
  ColorModeOptions,
  ColorTokenRef,
  ContextualVarRegistration,
  CSSColorValue,
  EmittedScales,
  EmittedTokenPaths,
  ScaleTokenRef,
  SerializedTheme,
  SystemPreferenceConfig,
  Theme,
  ThemeManifest,
  ThemeStructuralKey,
  TokenScales,
} from './types/theme';
