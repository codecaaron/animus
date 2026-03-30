import {
  AbstractTheme,
  CSSColorValue,
  SerializedTheme,
  ThemeManifest,
} from '../types/theme';
import { flattenScale, LiteralPaths } from './flattenScale';
import { KeyAsVariable, serializeTokens } from './serializeTokens';
import { ColorModeConfig, Merge, MergeTheme, PrivateThemeKeys } from './types';
import { isObject, mapValues, merge } from './utils';

// CSS named colors (lowercase for case-insensitive matching)
const CSS_NAMED_COLORS = new Set([
  'aliceblue',
  'antiquewhite',
  'aqua',
  'aquamarine',
  'azure',
  'beige',
  'bisque',
  'black',
  'blanchedalmond',
  'blue',
  'blueviolet',
  'brown',
  'burlywood',
  'cadetblue',
  'chartreuse',
  'chocolate',
  'coral',
  'cornflowerblue',
  'cornsilk',
  'crimson',
  'cyan',
  'darkblue',
  'darkcyan',
  'darkgoldenrod',
  'darkgray',
  'darkgreen',
  'darkgrey',
  'darkkhaki',
  'darkmagenta',
  'darkolivegreen',
  'darkorange',
  'darkorchid',
  'darkred',
  'darksalmon',
  'darkseagreen',
  'darkslateblue',
  'darkslategray',
  'darkslategrey',
  'darkturquoise',
  'darkviolet',
  'deeppink',
  'deepskyblue',
  'dimgray',
  'dimgrey',
  'dodgerblue',
  'firebrick',
  'floralwhite',
  'forestgreen',
  'fuchsia',
  'gainsboro',
  'ghostwhite',
  'gold',
  'goldenrod',
  'gray',
  'green',
  'greenyellow',
  'grey',
  'honeydew',
  'hotpink',
  'indianred',
  'indigo',
  'ivory',
  'khaki',
  'lavender',
  'lavenderblush',
  'lawngreen',
  'lemonchiffon',
  'lightblue',
  'lightcoral',
  'lightcyan',
  'lightgoldenrodyellow',
  'lightgray',
  'lightgreen',
  'lightgrey',
  'lightpink',
  'lightsalmon',
  'lightseagreen',
  'lightskyblue',
  'lightslategray',
  'lightslategrey',
  'lightsteelblue',
  'lightyellow',
  'lime',
  'limegreen',
  'linen',
  'magenta',
  'maroon',
  'mediumaquamarine',
  'mediumblue',
  'mediumorchid',
  'mediumpurple',
  'mediumseagreen',
  'mediumslateblue',
  'mediumspringgreen',
  'mediumturquoise',
  'mediumvioletred',
  'midnightblue',
  'mintcream',
  'mistyrose',
  'moccasin',
  'navajowhite',
  'navy',
  'oldlace',
  'olive',
  'olivedrab',
  'orange',
  'orangered',
  'orchid',
  'palegoldenrod',
  'palegreen',
  'paleturquoise',
  'palevioletred',
  'papayawhip',
  'peachpuff',
  'peru',
  'pink',
  'plum',
  'powderblue',
  'purple',
  'rebeccapurple',
  'red',
  'rosybrown',
  'royalblue',
  'saddlebrown',
  'salmon',
  'sandybrown',
  'seagreen',
  'seashell',
  'sienna',
  'silver',
  'skyblue',
  'slateblue',
  'slategray',
  'slategrey',
  'snow',
  'springgreen',
  'steelblue',
  'tan',
  'teal',
  'thistle',
  'tomato',
  'turquoise',
  'violet',
  'wheat',
  'white',
  'whitesmoke',
  'yellow',
  'yellowgreen',
]);

const COLOR_FUNCTION_PREFIXES = [
  'rgb(',
  'rgba(',
  'hsl(',
  'hsla(',
  'oklch(',
  'oklab(',
  'lch(',
  'lab(',
  'color(',
  'color-mix(',
];

/** Validate that a value is a valid CSS <color>. */
function isValidCSSColor(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (v === '') return false;

  // Special keywords
  if (v === 'transparent' || v === 'currentColor' || v === 'currentcolor')
    return true;

  // Hex colors
  if (
    v.startsWith('#') &&
    /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v)
  )
    return true;

  // CSS color functions
  for (const prefix of COLOR_FUNCTION_PREFIXES) {
    if (v.startsWith(prefix) && v.endsWith(')')) return true;
  }

  // Named CSS colors
  if (CSS_NAMED_COLORS.has(v.toLowerCase())) return true;

  return false;
}

/** Validate that mode aliases reference existing color keys. */
function validateModeAliases(
  modeName: string,
  aliases: Record<string, unknown>,
  colorSet: Set<string>,
  availableColors: string[],
  prefix: string
): void {
  for (const [key, value] of Object.entries(aliases)) {
    const aliasPath = prefix ? `${prefix}-${key}` : key;
    if (typeof value === 'string') {
      if (!colorSet.has(value)) {
        throw new Error(
          `addColorModes: mode '${modeName}' references unknown color '${value}' for alias '${aliasPath}'. ` +
            `Available colors: ${availableColors.slice(0, 10).join(', ')}${availableColors.length > 10 ? ', ...' : ''}`
        );
      }
    } else if (isObject(value)) {
      validateModeAliases(
        modeName,
        value as Record<string, unknown>,
        colorSet,
        availableColors,
        aliasPath
      );
    }
  }
}

/** Validate all color entries, throwing on invalid values. */
function validateColors(colors: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(colors)) {
    if (isObject(value)) {
      // Nested color objects — validate recursively
      validateColors(value as Record<string, unknown>);
    } else if (!isValidCSSColor(value)) {
      throw new Error(
        `addColors: '${String(value)}' is not a valid CSS <color> value for key '${key}'. ` +
          `Expected hex (#fff), rgb(), hsl(), oklch(), named color, transparent, or currentColor.`
      );
    }
  }
}

/**
 * Validate token refs in scale values at the type level.
 * Accepts `{scale.key}` for any emitted scale, plus `{colors.key/${number}}` opacity syntax.
 */
type ValidateScaleRef<V, ValidPaths extends string> = V extends string
  ? V extends `${string}{${infer Path}}${string}`
    ? Path extends ValidPaths
      ? V
      : Path extends `${infer Base}/${number}`
        ? Base extends ValidPaths & `colors.${string}`
          ? V
          : `{${Path}} is not a valid token ref`
        : `{${Path}} is not a valid token ref`
    : V
  : V;

/** Walk a values record and validate each value's token refs. */
type ValidateScaleValues<
  V extends Record<string | number, unknown>,
  ValidPaths extends string,
> = {
  [K in keyof V]: V[K] extends Record<string, unknown>
    ? ValidateScaleValues<V[K], ValidPaths>
    : ValidateScaleRef<V[K], ValidPaths>;
};

export class ThemeBuilder<
  T extends AbstractTheme,
  Emitted extends string = never,
> {
  #theme = {} as T;
  #emittedScales = new Set<string>();
  #contextualVars = new Map<string, string[]>();

  constructor(baseTheme: T) {
    // Validate breakpoint values
    if (baseTheme.breakpoints) {
      for (const [key, value] of Object.entries(baseTheme.breakpoints)) {
        if (typeof value !== 'number' || value < 0) {
          throw new Error(
            `createTheme: breakpoint '${key}' must be a non-negative number, got ${JSON.stringify(value)}`
          );
        }
      }
    }
    this.#theme = baseTheme;
  }

  /** Create a new builder checkpoint, carrying forward emittedScales and contextualVars state. */
  #checkpoint<NT extends AbstractTheme, NE extends string>(nextTheme: unknown) {
    const next = new ThemeBuilder<NT, NE>(nextTheme as NT);
    for (const s of this.#emittedScales) next.#emittedScales.add(s);
    for (const [scale, vars] of this.#contextualVars) {
      next.#contextualVars.set(scale, [...vars]);
    }
    return next;
  }

  /**
   * @param colors A map of color tokens. Immediately converted to CSS variables `--color-${key}`.
   * @example .addColors({ navy: 'navy', hyper: 'purple' })
   */
  addColors<
    Colors extends Record<
      string,
      CSSColorValue | Record<string, CSSColorValue>
    >,
    NextColors extends LiteralPaths<Colors, '-'>,
  >(colors: Colors) {
    validateColors(colors as Record<string, unknown>);
    const flatColors = flattenScale(colors);
    const { variables, tokens } = serializeTokens(
      flatColors as Record<string, string>,
      'color',
      this.#theme
    );

    const nextTheme = merge({}, this.#theme, {
      colors: tokens,
      _variables: { root: variables },
      _tokens: { colors: flatColors },
    });

    type Next = MergeTheme<
      T & PrivateThemeKeys,
      Record<'colors', KeyAsVariable<NextColors, 'color'>>
    >;

    const next = this.#checkpoint<Next, Emitted | 'colors'>(nextTheme);
    next.#emittedScales.add('colors');
    return next;
  }

  /**
   * @param initialMode Default color mode key.
   * @param modeConfig Map of color modes with semantic aliases pointing to palette keys.
   * @example .addColorModes('dark', { dark: { primary: 'ember' }, light: { primary: 'void' } })
   */
  addColorModes<
    Modes extends string,
    InitialMode extends keyof Config,
    Colors extends keyof T['colors'],
    ModeColors extends ColorModeConfig<Colors>,
    Config extends Record<Modes, ModeColors>,
    ColorAliases extends {
      [K in keyof Config]: LiteralPaths<Config[K], '-', '_'>;
    },
  >(initialMode: InitialMode, modeConfig: Config) {
    // Validate that all mode aliases reference existing color keys
    const availableColors = this.#theme._tokens?.colors
      ? Object.keys(this.#theme._tokens.colors as Record<string, unknown>)
      : Object.keys(this.#theme.colors || {});
    const colorSet = new Set(availableColors);
    for (const [modeName, modeAliases] of Object.entries(modeConfig)) {
      validateModeAliases(
        modeName,
        modeAliases as Record<string, unknown>,
        colorSet,
        availableColors,
        ''
      );
    }

    const modes = mapValues(modeConfig, (mode) => flattenScale(mode));

    const { tokens: colors, variables } = serializeTokens(
      mapValues(
        merge({}, this.#theme.modes?.[initialMode], modes[initialMode]),
        (color) => this.#theme.colors[color]
      ),
      'color',
      this.#theme
    );

    const getColorValue = (color: keyof T['colors']): string =>
      this.#theme._tokens?.colors?.[color];

    const nextTheme = merge({}, this.#theme, {
      colors,
      modes,
      mode: initialMode,
      _getColorValue: getColorValue,
      _variables: { mode: variables },
      _tokens: {
        modes: mapValues(modes, (mode) => mapValues(mode, getColorValue)),
      },
    });

    type Next = MergeTheme<
      T & PrivateThemeKeys,
      {
        colors: KeyAsVariable<
          LiteralPaths<Config[keyof Config], '-', '_'>,
          'colors'
        > &
          T['colors'];
        modes: Merge<T['modes'], ColorAliases>;
        mode: keyof Config;
        _getColorValue: (color: keyof T['colors']) => string;
      }
    >;

    return this.#checkpoint<Next, Emitted>(nextTheme);
  }

  /**
   * Add a named scale to the theme.
   *
   * @param config.name - Scale name (e.g. 'space', 'sizes')
   * @param config.values - Scale value map
   * @param config.emit - When true, generates CSS variables (default: false)
   *
   * @example
   * .addScale({ name: 'space', values: { 0: '0', 8: '0.5rem', 16: '1rem' } })
   * .addScale({ name: 'sizes', emit: true, values: { navHeight: '48px' } })
   */
  addScale<
    Key extends string,
    const Values extends Record<
      string | number,
      string | number | Record<string, string | number>
    >,
    Emit extends boolean = false,
    NewScale extends LiteralPaths<Values, '-'> = LiteralPaths<Values, '-'>,
    // Exhaustive set of valid token ref paths from all emitted scales on the current theme
    ValidPaths extends string = keyof LiteralPaths<
      Pick<T, Extract<Emitted | 'colors', keyof T>>,
      '.'
    > &
      string,
  >(config: {
    name: Key;
    values: Values & ValidateScaleValues<Values, ValidPaths>;
    emit?: Emit;
  }) {
    const { name, values, emit } = config;
    const flattened = flattenScale(values);

    let nextTheme: Record<string, unknown>;

    if (emit) {
      const { variables, tokens } = serializeTokens(
        flattened as Record<string, string>,
        name,
        this.#theme
      );
      nextTheme = merge({}, this.#theme, {
        [name]: tokens,
        _variables: { [name]: variables },
        _tokens: { [name]: flattened },
      });
    } else {
      nextTheme = merge({}, this.#theme, {
        [name]: flattened,
      });
    }

    // Flatten the merged type at each step to prevent MergeTheme depth accumulation
    type ScaleType = Emit extends true
      ? KeyAsVariable<NewScale, Key>
      : NewScale;
    type Merged = MergeTheme<T, Record<Key, ScaleType>>;
    type Next = { [K in keyof Merged]: Merged[K] };
    type NextEmitted = Emit extends true ? Emitted | Key : Emitted;

    const next = this.#checkpoint<Next, NextEmitted>(nextTheme);
    if (emit) next.#emittedScales.add(name);
    return next;
  }

  /**
   * Declare contextual CSS variables as phantom members of their scales.
   * These names appear in the scale's type but resolve to CSS custom properties
   * (`--{name}`) instead of token values. They cascade through the DOM like `currentColor`.
   *
   * @param vars - Object mapping scale names to arrays of contextual var names.
   *
   * @example
   * .addContextualVars({
   *   colors: ['current-bg', 'current-border-color'],
   * })
   */
  addContextualVars<
    const Vars extends Partial<{
      [K in keyof T & string]: readonly string[];
    }>,
  >(vars: Vars) {
    // Runtime ordering guard — all referenced scales must exist
    for (const scale of Object.keys(vars)) {
      if (!(scale in this.#theme)) {
        throw new Error(
          `addContextualVars: scale '${scale}' not found — call addColors or addScale first`
        );
      }
    }

    // Phantom type merge — keys exist in the type but not in the runtime theme object
    // Values typed as var(--*) to match emitted scale pattern (used by EmittedScales<T>)
    type WithPhantoms = {
      [K in keyof T]: K extends keyof Vars
        ? Vars[K] extends readonly string[]
          ? T[K] & Record<Vars[K][number], `var(--${string})`>
          : T[K]
        : T[K];
    };

    const next = this.#checkpoint<WithPhantoms, Emitted>(this.#theme);
    for (const [scale, names] of Object.entries(vars)) {
      const existing = next.#contextualVars.get(scale) || [];
      next.#contextualVars.set(scale, [
        ...existing,
        ...(names as readonly string[]),
      ]);
    }
    return next;
  }

  /**
   * @param key A current key of theme to update with computed values.
   * @example .updateScale('fonts', ({ basic }) => ({ basicFallback: `${basic}, Montserrat` }))
   */
  updateScale<
    Key extends keyof T,
    Fn extends (tokens: T[Key]) => Record<string | number, unknown>,
  >(key: Key, updateFn: Fn) {
    const nextTheme = merge({}, this.#theme, {
      [key]: updateFn(this.#theme[key]),
    });

    return this.#checkpoint<T & Record<Key, T[Key] & ReturnType<Fn>>, Emitted>(
      nextTheme
    );
  }

  /**
   * Finalize the theme build.
   * Returns the theme with non-enumerable `.manifest` and `.serialize()` properties.
   */
  build(): {
    [K in keyof (T & PrivateThemeKeys)]: (T & PrivateThemeKeys)[K];
  } & { manifest: ThemeManifest; serialize(): SerializedTheme } {
    // Resolve token refs in all scale values before serialization
    resolveThemeTokenRefs(this.#theme, this.#emittedScales);

    const { variables } = serializeTokens(
      mapValues(this.#theme.breakpoints, (val) => `${val}px`),
      'breakpoint',
      this.#theme
    );

    // Only include contextual vars in the theme if any were declared
    let contextualVarsSerialized: Record<string, string[]> | undefined;
    if (this.#contextualVars.size > 0) {
      contextualVarsSerialized = {};
      for (const [scale, vars] of this.#contextualVars) {
        contextualVarsSerialized[scale] = vars;
      }
    }

    const theme = merge({}, this.#theme, {
      _variables: { breakpoints: variables },
      _tokens: {},
      ...(contextualVarsSerialized
        ? { _contextualVars: contextualVarsSerialized }
        : {}),
    });

    // Assemble the ThemeManifest — structured metadata for the plugin
    const manifest = assembleManifest(theme);
    Object.defineProperty(theme, 'manifest', {
      value: manifest,
      enumerable: false,
      configurable: false,
      writable: false,
    });

    // Pipeline-ready serialization — JSON-stringified manifest fields
    Object.defineProperty(theme, 'serialize', {
      value: (): SerializedTheme => ({
        scalesJson: JSON.stringify(manifest.tokenMap),
        variableMapJson: JSON.stringify(manifest.variableMap),
        variableCss: manifest.variableCss,
        contextualVarsJson: JSON.stringify(manifest.contextualVars ?? {}),
      }),
      enumerable: false,
      configurable: false,
      writable: false,
    });

    return theme as typeof theme & {
      manifest: ThemeManifest;
      serialize(): SerializedTheme;
    };
  }
}

export function createTheme<T extends AbstractTheme>(base: T) {
  return new ThemeBuilder(base);
}

/** Token ref pattern: {scale.key} */
const TOKEN_REF_RE = /\{([^}]+)\}/g;

/**
 * Resolve token refs ({scale.key}) in all scale values.
 * Only refs to emitted scales (those with CSS variables) are valid.
 * Runs once at build() time after all scales have been collected.
 */
function resolveThemeTokenRefs(
  theme: Record<string, any>,
  emittedScales: Set<string>
): void {
  for (const [scaleName, scaleValue] of Object.entries(theme)) {
    if (scaleName.startsWith('_')) continue;
    if (
      scaleName === 'breakpoints' ||
      scaleName === 'mode' ||
      scaleName === 'modes'
    )
      continue;
    if (typeof scaleValue === 'function') continue;
    if (!isObject(scaleValue)) continue;

    for (const [key, value] of Object.entries(
      scaleValue as Record<string, unknown>
    )) {
      if (typeof value !== 'string') continue;
      if (!value.includes('{')) continue;

      const resolved = value.replace(TOKEN_REF_RE, (match, ref: string) => {
        const dotIdx = ref.indexOf('.');
        if (dotIdx === -1) return match;
        const refScale = ref.slice(0, dotIdx);
        const refKey = ref.slice(dotIdx + 1);

        // Check self-reference
        if (refScale === scaleName) {
          // biome-ignore lint/suspicious/noConsole: intentional runtime diagnostic
          console.warn(
            `[animus] Self-referential token ref {${ref}} in scale '${scaleName}' — skipped`
          );
          return match;
        }

        // Look up the referenced value in the theme
        const targetScale = theme[refScale];
        if (!targetScale || !isObject(targetScale)) {
          // biome-ignore lint/suspicious/noConsole: intentional runtime diagnostic
          console.warn(
            `[animus] Token ref {${ref}} references unknown scale '${refScale}'`
          );
          return match;
        }

        const resolvedValue = (targetScale as Record<string, unknown>)[refKey];
        if (resolvedValue === undefined) {
          // biome-ignore lint/suspicious/noConsole: intentional runtime diagnostic
          console.warn(
            `[animus] Token ref {${ref}} — key '${refKey}' not found in scale '${refScale}'`
          );
          return match;
        }

        return String(resolvedValue);
      });

      if (resolved !== value) {
        (scaleValue as Record<string, unknown>)[key] = resolved;
        // Also update _tokens if this scale was emitted
        if (theme._tokens?.[scaleName]) {
          theme._tokens[scaleName][key] = resolved;
        }
        // Also update _variables if this scale was emitted
        if (theme._variables?.[scaleName]) {
          const varName = `--${scaleName}-${key.replace('$', '')}`;
          if (theme._variables[scaleName][varName] !== undefined) {
            theme._variables[scaleName][varName] = resolved;
          }
        }
      }
    }
  }
}

/**
 * Assemble a ThemeManifest from the built theme object.
 *
 * This is the single source of truth for the plugin — no string-matching
 * or re-flattening needed downstream.
 */
function assembleManifest(theme: Record<string, any>): ThemeManifest {
  const tokenMap: Record<string, string> = {};
  const variableMap: Record<string, string> = {};

  // Flatten all scale maps (including breakpoints) into tokenMap, and extract variable mappings.
  // Breakpoints are included so the Rust crate's extract_breakpoints() can find them.
  for (const [scaleName, scaleValue] of Object.entries(theme)) {
    if (scaleName.startsWith('_')) continue;
    if (scaleName === 'mode' || scaleName === 'modes') continue;
    if (typeof scaleValue === 'function') continue;

    if (isObject(scaleValue)) {
      flattenTokens(
        tokenMap,
        variableMap,
        scaleName,
        scaleValue as Record<string, unknown>
      );
    }
  }

  // Build modes from _tokens.modes (resolved raw values)
  const modes: Record<string, Record<string, string>> = {};
  if (theme._tokens?.modes && isObject(theme._tokens.modes)) {
    for (const [modeName, modeTokens] of Object.entries(theme._tokens.modes)) {
      if (!isObject(modeTokens)) continue;
      const modeMap: Record<string, string> = {};
      flattenModeEntries(modeMap, modeTokens as Record<string, unknown>, '');
      modes[modeName] = modeMap;
    }
  }

  // Build variable CSS from _variables and _tokens.modes
  const variableCss = buildManifestVariableCss(theme);

  // Include contextual vars registry if present
  const contextualVars =
    theme._contextualVars &&
    typeof theme._contextualVars === 'object' &&
    Object.keys(theme._contextualVars).length > 0
      ? (theme._contextualVars as Record<string, string[]>)
      : undefined;

  return { tokenMap, variableMap, modes, variableCss, contextualVars };
}

/** Flatten a scale into tokenMap and extract variable references into variableMap. */
function flattenTokens(
  tokenMap: Record<string, string>,
  variableMap: Record<string, string>,
  prefix: string,
  obj: Record<string, unknown>,
  parentKey = ''
): void {
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = parentKey ? `${parentKey}-${key}` : key;
    if (isObject(value)) {
      flattenTokens(
        tokenMap,
        variableMap,
        prefix,
        value as Record<string, unknown>,
        fullKey
      );
    } else {
      const tokenPath = `${prefix}.${fullKey}`;
      const strValue = String(value);
      tokenMap[tokenPath] = strValue;
      // If the value is a var() reference, extract the variable name
      if (strValue.startsWith('var(') && strValue.endsWith(')')) {
        variableMap[tokenPath] = strValue.slice(4, -1);
      }
    }
  }
}

/** Flatten mode token entries (resolved values) into a flat key→value map. */
function flattenModeEntries(
  modeMap: Record<string, string>,
  obj: Record<string, unknown>,
  prefix: string
): void {
  for (const [key, value] of Object.entries(obj)) {
    const namePart = key === '_' ? prefix : prefix ? `${prefix}-${key}` : key;
    if (typeof value === 'string' || typeof value === 'number') {
      modeMap[`colors.${namePart}`] = String(value);
    } else if (isObject(value)) {
      flattenModeEntries(modeMap, value as Record<string, unknown>, namePart);
    }
  }
}

/** Build CSS variable blocks from theme._variables and _tokens.modes. */
function buildManifestVariableCss(theme: Record<string, any>): string {
  const parts: string[] = [];

  // :root block from _variables
  if (theme._variables && isObject(theme._variables)) {
    const rootLines: string[] = [];
    for (const categoryValue of Object.values(theme._variables)) {
      if (!isObject(categoryValue)) continue;
      for (const [cssVar, cssValue] of Object.entries(
        categoryValue as Record<string, unknown>
      )) {
        if (typeof cssValue === 'string') {
          rootLines.push(`  ${cssVar}: ${cssValue};`);
        }
      }
    }
    if (rootLines.length > 0) {
      parts.push(`:root {\n${rootLines.join('\n')}\n}`);
    }
  }

  // [data-color-mode] blocks from _tokens.modes
  if (theme._tokens?.modes && isObject(theme._tokens.modes)) {
    for (const [modeName, modeTokens] of Object.entries(
      theme._tokens.modes as Record<string, unknown>
    )) {
      if (!isObject(modeTokens)) continue;
      const modeLines: string[] = [];
      flattenModeTokensCss(
        modeLines,
        modeTokens as Record<string, unknown>,
        ''
      );
      if (modeLines.length > 0) {
        parts.push(
          `[data-color-mode="${modeName}"] {\n${modeLines.join('\n')}\n}`
        );
      }
    }
  }

  return parts.join('\n\n');
}

/** Recursively flatten mode tokens into CSS variable declaration lines. */
function flattenModeTokensCss(
  lines: string[],
  obj: Record<string, unknown>,
  prefix: string
): void {
  for (const [key, value] of Object.entries(obj)) {
    const namePart = key === '_' ? prefix : prefix ? `${prefix}-${key}` : key;
    if (typeof value === 'string' || typeof value === 'number') {
      lines.push(`  --color-${namePart}: ${value};`);
    } else if (isObject(value)) {
      flattenModeTokensCss(lines, value as Record<string, unknown>, namePart);
    }
  }
}
