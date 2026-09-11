import type { LiteralPaths } from '../theme/flattenScale';

export type { CSSObject } from './shared';

export interface BaseTheme {}

export interface AbstractTheme extends BaseTheme {
  breakpoints: Record<string, number>;
  readonly [key: string]: any;
}

export type ThemeStructuralKey =
  | 'breakpoints'
  | 'modes'
  | 'mode'
  | 'systemPreference'
  | 'browserColorScheme'
  | 'modeBases'
  | '__emitted'
  | 'manifest'
  | 'serialize'
  | 'varRef';

export type TokenScales<T> = Omit<T, ThemeStructuralKey>;

/**
 * Consumers augment this interface to constrain CSS values to their theme's
 * scale keys; unaugmented, values fall back to standard CSS property types.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface Theme extends BaseTheme {}

export type CSSColorValue =
  | `#${string}`
  | `rgb(${string})`
  | `rgba(${string})`
  | `hsl(${string})`
  | `hsla(${string})`
  | `oklch(${string})`
  | `oklab(${string})`
  | `lch(${string})`
  | `lab(${string})`
  | `color-mix(${string})`
  | `color(${string})`
  | 'transparent'
  | 'currentColor'
  | (string & {});

/**
 * Scale names emitted as CSS variables. The `colors` fallback covers augmented
 * `Theme` interfaces, which carry no `__emitted` tuple.
 */
export type EmittedScales<T> = T extends { __emitted: [infer E extends string] }
  ? E & keyof TokenScales<T>
  : 'colors' extends keyof TokenScales<T>
    ? 'colors'
    : never;

export type EmittedTokenPaths<T> = keyof LiteralPaths<
  Pick<TokenScales<T>, EmittedScales<T>>,
  '.'
>;

export type ScaleTokenRef<E extends string> =
  `${string}{${E}.${string}}${string}`;

export type ColorTokenRef = Theme extends { colors: infer C }
  ? C extends Record<string, unknown>
    ?
        | `{colors.${Extract<keyof C, string>}}`
        | `{colors.${Extract<keyof C, string>}/${number}}`
    : never
  : never;

export interface ContextualVarRegistration {
  syntax: string;
  inherits: boolean;
  initialValue?: string;
}

export interface SystemPreferenceConfig {
  light: string;
  dark: string;
}

export type BrowserColorSchemeConfig = Record<
  string,
  'light' | 'dark' | 'normal'
>;

/**
 * Options for `addColorModes`, typed from this call's mode config alone —
 * threading the mode union through the builder generics risks TS2589.
 */
export interface ColorModeOptions<Config> {
  systemPreference?: {
    light: keyof Config & string;
    dark: keyof Config & string;
  };
  browserColorScheme?: Partial<
    Record<keyof Config & string, 'light' | 'dark' | 'normal'>
  >;
  basedOn?: Partial<Record<keyof Config & string, string>>;
}

export interface SerializedTheme {
  scalesJson: string;
  variableMapJson: string;
  variableCss: string;
  contextualVarsJson: string;
}

export interface TokenReference {
  path: string;
  opacity?: string;
}

export type TokenDefinition =
  | { kind: 'literal'; value: string }
  | { kind: 'reference'; value: string; references: TokenReference[] };

export type ModeAliasDefinition = Record<string, Record<string, string>>;

export interface ThemeCssFragment {
  id: string;
  kind: 'registrations' | 'base';
  cssText: string;
}

export interface ThemeManifest {
  tokenMap: Record<string, string>;
  variableMap: Record<string, string>;
  /**
   * Mode name → flat key → resolved value; a reference contributes its resolved
   * value, never a raw `{…}` string. Mode keys and inner keys are sorted.
   */
  modes: Record<string, Record<string, string>>;
  variableCss: string;
  contextualVars?: Record<string, string[]>;
  systemPreference?: SystemPreferenceConfig;
  browserColorScheme?: BrowserColorSchemeConfig;
  manifestVersion?: 2;
  tokenDefinitions?: Record<string, TokenDefinition>;
  emittedScales?: string[];
  modeAliasDefinitions?: ModeAliasDefinition;
  registrations?: Record<string, ContextualVarRegistration>;
  emitterVersion?: number;
  contractHash?: string;
  cssFragments?: ThemeCssFragment[];
}
