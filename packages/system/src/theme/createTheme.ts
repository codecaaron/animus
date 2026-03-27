import { AbstractTheme, CSSColorValue, ThemeManifest } from '../types/theme';
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

export class ThemeBuilder<T extends AbstractTheme> {
  #theme = {} as T;

  constructor(baseTheme: T) {
    this.#theme = baseTheme;
  }
  /**
   *
   * @param key A key of the current theme to transform into CSS Variables and Variable References
   * @example .createScaleVariables('fontSize')
   */
  createScaleVariables<Key extends keyof Omit<T, 'breakpoints'> & string>(
    key: Key
  ): ThemeBuilder<
    MergeTheme<
      T,
      PrivateThemeKeys,
      Record<Key, Record<Key, KeyAsVariable<T[Key], Key>>>
    >
  > {
    const { variables, tokens } = serializeTokens(
      this.#theme[key],
      key,
      this.#theme
    );

    this.#theme = merge({}, this.#theme, {
      [key]: tokens,
      _variables: { [key]: variables },
      _tokens: {
        [key]: this.#theme[key],
      },
    });

    return this;
  }

  /**
   *
   * @param colors A map of color tokens to add to the theme. These tokens are immediately converted to CSS Variables `--color-${key}`.
   * @example .addColors({ navy: 'navy', hyper: 'purple' })
   */
  addColors<
    Colors extends Record<
      string,
      CSSColorValue | Record<string, CSSColorValue>
    >,
    NextColors extends LiteralPaths<Colors, '-'>,
  >(
    colors: Colors
  ): ThemeBuilder<
    MergeTheme<
      T & PrivateThemeKeys,
      Record<'colors', KeyAsVariable<NextColors, 'color'>>
    >
  > {
    validateColors(colors as Record<string, unknown>);
    const flatColors = flattenScale(colors);
    const { variables, tokens } = serializeTokens(
      flatColors as Record<string, string>,
      'color',
      this.#theme
    );
    this.#theme = merge({}, this.#theme, {
      colors: tokens,
      _variables: { root: variables },
      _tokens: { colors: flatColors },
    });

    return this;
  }

  /**
   *
   * @param initialMode A key of the object passed for modes.  This sets the default state for the theme and transforms the correct variables.
   * @param modes A map of color modes with keys of each possible mode with a value of alias to color keys.  This must be called after `addColors`
   * @example .addColorModes('light', { light: { primary: 'hyper' }, { dark: { primary: 'navy' } } })
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
  >(
    initialMode: InitialMode,
    modeConfig: Config
  ): ThemeBuilder<
    MergeTheme<
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
    >
  > {
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

    this.#theme = merge({}, this.#theme, {
      colors,
      modes,
      mode: initialMode,
      _getColorValue: getColorValue,
      _variables: { mode: variables },
      _tokens: {
        modes: mapValues(modes, (mode) => mapValues(mode, getColorValue)),
      },
    });

    return this;
  }

  /**
   *
   * @param key A new key of theme
   * @param createScale A function that accepts the current theme and returns a new object of scale values.
   * @example .addScale('fonts', () => ({ basic: 'Gotham', cool: 'Wingdings' }))
   */
  addScale<
    Key extends string,
    Fn extends (
      theme: T
    ) => Record<
      string | number,
      string | number | Record<string, string | number>
    >,
    NewScale extends LiteralPaths<ReturnType<Fn>, '-'>,
  >(
    key: Key,
    createScale: Fn
  ): ThemeBuilder<{
    [K in keyof MergeTheme<T, Record<Key, NewScale>>]: MergeTheme<
      T,
      Record<Key, NewScale>
    >[K];
  }> {
    this.#theme = merge({}, this.#theme, {
      [key]: flattenScale(createScale(this.#theme)),
    });
    return this;
  }

  /**
   *
   * @param key A current key of theme to be updated with new or computed values
   * @param updateFn A function that accepts an argument of the current values at the specified keys an returns a map of new values to merge.
   * @example .updateScale('fonts', ({ basic }) => ({ basicFallback: `{basic}, Montserrat` }))
   */
  updateScale<
    Key extends keyof T,
    Fn extends (tokens: T[Key]) => Record<string | number, unknown>,
  >(
    key: Key,
    updateFn: Fn
  ): ThemeBuilder<T & Record<Key, T[Key] & ReturnType<Fn>>> {
    this.#theme = merge({}, this.#theme, { [key]: updateFn(this.#theme[key]) });

    return this;
  }

  /**
   * This finalizes the theme build and returns the final theme and variables to be provided.
   * Simplify flattens the deeply nested MergeTheme chain into a shallow object type.
   *
   * The returned theme object also has a non-enumerable `.manifest` property containing
   * a structured ThemeManifest for plugin consumption.
   */
  build(): { [K in keyof (T & PrivateThemeKeys)]: (T & PrivateThemeKeys)[K] } {
    const { variables } = serializeTokens(
      mapValues(this.#theme.breakpoints, (val) => `${val}px`),
      'breakpoint',
      this.#theme
    );

    const theme = merge({}, this.#theme, {
      _variables: { breakpoints: variables },
      _tokens: {},
    });

    // Assemble the ThemeManifest — structured metadata for the plugin
    const manifest = assembleManifest(theme);
    Object.defineProperty(theme, 'manifest', {
      value: manifest,
      enumerable: false,
      configurable: false,
      writable: false,
    });

    return theme;
  }
}

export function createTheme<T extends AbstractTheme>(base: T) {
  return new ThemeBuilder(base);
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

  // Flatten all scale maps into tokenMap, and extract variable mappings
  for (const [scaleName, scaleValue] of Object.entries(theme)) {
    if (scaleName.startsWith('_')) continue;
    if (
      scaleName === 'breakpoints' ||
      scaleName === 'mode' ||
      scaleName === 'modes'
    )
      continue;
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

  return { tokenMap, variableMap, modes, variableCss };
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
