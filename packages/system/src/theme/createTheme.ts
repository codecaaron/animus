import { CSSColorValue, SerializedTheme, ThemeManifest } from '../types/theme';
import { LiteralPaths } from './flattenScale';
import {
  dotToDash,
  flattenToDotPaths,
  isObject,
  merge,
  walkDotPath,
} from './utils';

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

  // Bare strings (named CSS colors, etc.) — let the browser validate
  if (/^[a-zA-Z]+$/.test(v)) return true;

  return false;
}

/**
 * Validate that mode aliases reference existing color keys via dot-path traversal.
 * Aliases are dot-path strings like 'gray.50' that must resolve in the nested color structure.
 */
function validateModeAliases(
  modeName: string,
  aliases: Record<string, unknown>,
  nestedColors: Record<string, unknown>,
  flatColorKeys: string[],
  prefix: string
): void {
  for (const [key, value] of Object.entries(aliases)) {
    const aliasPath = prefix ? `${prefix}.${key}` : key;
    if (key === '_') {
      // Identity key — validate the value, not the key
      if (typeof value === 'string') {
        if (walkDotPath(nestedColors, value) === undefined) {
          throw new Error(
            `addColorModes: mode '${modeName}' references unknown color '${value}' for alias '${prefix || key}'. ` +
              `Available colors: ${flatColorKeys.slice(0, 10).join(', ')}${flatColorKeys.length > 10 ? ', ...' : ''}`
          );
        }
      } else if (isObject(value)) {
        validateModeAliases(
          modeName,
          value as Record<string, unknown>,
          nestedColors,
          flatColorKeys,
          prefix
        );
      }
    } else if (typeof value === 'string') {
      if (walkDotPath(nestedColors, value) === undefined) {
        throw new Error(
          `addColorModes: mode '${modeName}' references unknown color '${value}' for alias '${aliasPath}'. ` +
            `Available colors: ${flatColorKeys.slice(0, 10).join(', ')}${flatColorKeys.length > 10 ? ', ...' : ''}`
        );
      }
    } else if (isObject(value)) {
      validateModeAliases(
        modeName,
        value as Record<string, unknown>,
        nestedColors,
        flatColorKeys,
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

// Token ref validation types (ValidateScaleRef, ValidateScaleValues) removed
// to prevent TS2589 depth explosion. Token refs are validated at runtime in
// resolveTokenRefs() during build(). Type-level validation can be restored
// when the type-state chain depth is optimized.

// ─── Type Helpers ───────────────────────────────────────────

/** Flatten a type to prevent MergeTheme depth accumulation (TS2589). Exported for use in consumer themes. */
export type Flatten<T> = { [K in keyof T]: T[K] };

/** The built theme: nested raw data + non-enumerable boundary methods */
type BuiltTheme<T, Emitted extends string> = {
  [K in keyof T]: T[K];
} & {
  /** Phantom — tuple wrapper prevents never-distribution. Non-enumerable at runtime. */
  readonly __emitted: [Emitted];
  manifest: ThemeManifest;
  serialize(): SerializedTheme;
  /** Resolve a dot-path token to its var() reference. Runtime-validated against the manifest. */
  varRef(tokenPath: string): string | undefined;
};

// ─── ThemeBuilder: Progressive Disclosure ───────────────────
//
// Separate classes per phase, each with new TYPE INSTANTIATION.
// This forces TS to cache the concrete type at each step, preventing
// TS2589 depth accumulation on long chains. Same pattern as Animus.ts.

/** Shared runtime state passed between builder phases. */
interface BuilderState {
  theme: Record<string, unknown>;
  emittedScales: Set<string>;
  contextualVars: Map<string, string[]>;
}

function createState(theme?: Record<string, unknown>): BuilderState {
  return {
    theme: theme || { breakpoints: {} },
    emittedScales: new Set(),
    contextualVars: new Map(),
  };
}

function copyState(
  state: BuilderState,
  nextTheme: Record<string, unknown>
): BuilderState {
  const next: BuilderState = {
    theme: nextTheme,
    emittedScales: new Set(state.emittedScales),
    contextualVars: new Map(),
  };
  for (const [scale, vars] of state.contextualVars) {
    next.contextualVars.set(scale, [...vars]);
  }
  return next;
}

/**
 * ThemeScales — the final phase. Has addScale, extendScale, declareContextualVars, build.
 * Also allows addColors and addColorModes for augmentation.
 */
export class ThemeBuilder<
  T extends Record<string, unknown> = Record<string, unknown>,
  Emitted extends string = never,
> {
  /** @internal */ _state: BuilderState;

  constructor(state: BuilderState) {
    this._state = state;
  }

  addBreakpoints<BP extends Record<string, number>>(breakpoints: BP) {
    for (const [key, value] of Object.entries(breakpoints)) {
      if (typeof value !== 'number' || value < 0) {
        throw new Error(
          `addBreakpoints: breakpoint '${key}' must be a non-negative number, got ${JSON.stringify(value)}`
        );
      }
    }
    const nextTheme = merge({}, this._state.theme, { breakpoints });
    // Omit<T, 'breakpoints'> replaces the Record<string, number> from EmptyTheme
    // with literal keys, preventing index signature from widening keyof breakpoints to string
    type Merged = Omit<T, 'breakpoints'> &
      Record<'breakpoints', { [K in keyof BP]: BP[K] }>;
    type Next = { [K in keyof Merged]: Merged[K] };
    return new ThemeBuilder<Next, Emitted>(copyState(this._state, nextTheme));
  }

  from<Source extends Record<string, unknown>>(builtTheme: Source) {
    const raw: Record<string, unknown> = {};
    for (const key of Object.keys(builtTheme)) {
      const val = builtTheme[key];
      if (typeof val !== 'function') {
        raw[key] = val;
      }
    }
    const nextTheme = merge({}, this._state.theme, raw);
    const next = new ThemeBuilder<T & Source, Emitted>(
      copyState(this._state, nextTheme)
    );

    const manifest = (builtTheme as Record<string, unknown>).manifest as
      | ThemeManifest
      | undefined;
    if (manifest?.variableMap) {
      for (const tokenPath of Object.keys(manifest.variableMap)) {
        const scale = tokenPath.split('.')[0];
        next._state.emittedScales.add(scale === 'colors' ? 'colors' : scale);
      }
    }
    if (manifest?.contextualVars) {
      for (const [scale, vars] of Object.entries(manifest.contextualVars)) {
        next._state.contextualVars.set(scale, [...vars]);
      }
    }
    return next;
  }

  addColors<
    Colors extends Record<
      string,
      CSSColorValue | Record<string, CSSColorValue>
    >,
    // Generic default forces TS to resolve LiteralPaths ONCE and bind the result.
    // Downstream methods see NextColors (a flat Record) — no re-derivation.
    NextColors extends LiteralPaths<Colors, '.'> = LiteralPaths<Colors, '.'>,
  >(colors: Colors) {
    validateColors(colors as Record<string, unknown>);
    const nextTheme = merge({}, this._state.theme, { colors });
    // NextColors is RESOLVED — a flat Record<'gray.50', '#fafafa'>.
    // The flatten pattern commits the intersection to a concrete shape.
    type Merged = T & Record<'colors', NextColors>;
    type Next = { [K in keyof Merged]: Merged[K] };
    const next = new ThemeBuilder<Next, Emitted | 'colors'>(
      copyState(this._state, nextTheme)
    );
    next._state.emittedScales.add('colors');
    return next;
  }

  addColorModes<
    Config extends Record<string, Record<string, unknown>>,
    // Generic default forces ONE eval of mode alias paths (union across all modes).
    // The '_' base param collapses identity keys: { _: 'x', hover: 'y' } → 'primary' | 'primary.hover'
    AliasKeys extends LiteralPaths<
      Config[keyof Config],
      '.',
      '_'
    > = LiteralPaths<Config[keyof Config], '.', '_'>,
  >(initialMode: string, modeConfig: Config) {
    const nestedColors = (this._state.theme.colors || {}) as Record<
      string,
      unknown
    >;
    const flatColors = flattenToDotPaths(nestedColors);
    const flatColorKeys = Object.keys(flatColors);
    for (const [modeName, modeAliases] of Object.entries(modeConfig)) {
      validateModeAliases(
        modeName,
        modeAliases as Record<string, unknown>,
        nestedColors,
        flatColorKeys,
        ''
      );
    }

    const nextTheme = merge({}, this._state.theme, {
      modes: modeConfig,
      mode: initialMode,
    });

    // Colors type = existing palette keys + mode alias keys (superset)
    // AliasKeys is RESOLVED — a flat Record of alias dot-paths.
    type ColorsWithModes = (T extends { colors: infer C } ? C : unknown) &
      AliasKeys;
    type Merged = Omit<T, 'colors'> & Record<'colors', ColorsWithModes>;
    type Next = { [K in keyof Merged]: Merged[K] };
    return new ThemeBuilder<Next, Emitted>(copyState(this._state, nextTheme));
  }

  addScale<
    Key extends string,
    Values extends Record<
      string | number,
      string | number | Record<string, string | number>
    >,
    Emit extends boolean = false,
    // Generic default forces TS to resolve LiteralPaths ONCE and bind the result.
    NewScale extends LiteralPaths<Values, '.'> = LiteralPaths<Values, '.'>,
  >(config: { name: Key; values: Values; emit?: Emit }) {
    const { name, values, emit } = config;
    const nextTheme = merge({}, this._state.theme, { [name]: values });
    // NewScale is RESOLVED — a flat Record. Downstream sees concrete keys.
    type NextEmitted = Emit extends true ? Emitted | Key : Emitted;
    type Merged = T & Record<Key, NewScale>;
    type Next = { [K in keyof Merged]: Merged[K] };
    const next = new ThemeBuilder<Next, NextEmitted>(
      copyState(this._state, nextTheme)
    );
    if (emit) next._state.emittedScales.add(name);
    return next;
  }

  declareContextualVars<
    const Vars extends Partial<{
      [K in keyof T & string]: readonly string[];
    }>,
  >(vars: Vars) {
    for (const scale of Object.keys(vars)) {
      if (!(scale in this._state.theme)) {
        throw new Error(
          `declareContextualVars: scale '${scale}' not found — call addColors or addScale first`
        );
      }
    }

    // Phantom type merge — keys exist in the type but not in the runtime theme object.
    type WithPhantoms = {
      [K in keyof T]: K extends keyof Vars
        ? Vars[K] extends readonly string[]
          ? T[K] & Record<Vars[K][number], `var(--${string})`>
          : T[K]
        : T[K];
    };

    const next = new ThemeBuilder<WithPhantoms, Emitted>(
      copyState(this._state, this._state.theme)
    );
    for (const [scale, names] of Object.entries(vars)) {
      const existing = next._state.contextualVars.get(scale) || [];
      next._state.contextualVars.set(scale, [
        ...existing,
        ...(names as readonly string[]),
      ]);
    }
    return next;
  }

  extendScale<
    Key extends keyof T,
    Fn extends (tokens: T[Key]) => Record<string | number, unknown>,
  >(key: Key, updateFn: Fn) {
    const nextTheme = merge({}, this._state.theme, {
      [key]: updateFn(this._state.theme[key as string] as T[Key]),
    });
    // Flatten the intersection to prevent depth accumulation
    type Extended = T & Record<Key, T[Key] & ReturnType<Fn>>;
    type Next = { [K in keyof Extended]: Extended[K] };
    return new ThemeBuilder<Next, Emitted>(copyState(this._state, nextTheme));
  }

  /**
   * Finalize the theme build.
   * Flattens nested data at the boundary — produces manifest and serialize().
   */
  build(): BuiltTheme<T, Emitted> {
    const theme = merge({}, this._state.theme) as Record<string, unknown>;
    const emittedScales = this._state.emittedScales;
    const contextualVars = this._state.contextualVars;

    // ── Build-time flatten pass ────────────────────────────
    const { tokenMap, variableMap, variables, modeVariables, modeTokens } =
      flattenTheme(theme, emittedScales);

    // Resolve token refs in the flattened token map
    resolveTokenRefs(tokenMap, variableMap, emittedScales);

    // Serialize breakpoints
    const bpVariables: Record<string, string> = {};
    if (theme.breakpoints && isObject(theme.breakpoints)) {
      for (const [key, value] of Object.entries(
        theme.breakpoints as Record<string, number>
      )) {
        bpVariables[`--breakpoint-${key}`] = `${value}px`;
      }
    }

    // Contextual vars
    let contextualVarsSerialized: Record<string, string[]> | undefined;
    if (contextualVars.size > 0) {
      contextualVarsSerialized = {};
      for (const [scale, vars] of contextualVars) {
        contextualVarsSerialized[scale] = vars;
      }
    }

    // ── Assemble manifest ──────────────────────────────────
    const variableCss = buildVariableCss(variables, bpVariables, modeVariables);

    const manifest: ThemeManifest = {
      tokenMap: {
        ...tokenMap,
        // Include breakpoints in tokenMap for Rust crate compatibility
        ...Object.fromEntries(
          Object.entries(theme.breakpoints || {}).map(([k, v]) => [
            `breakpoints.${k}`,
            String(v),
          ])
        ),
      },
      variableMap,
      modes: modeTokens,
      variableCss,
      ...(contextualVarsSerialized
        ? { contextualVars: contextualVarsSerialized }
        : {}),
    };

    // ── Attach non-enumerable methods ──────────────────────
    Object.defineProperty(theme, 'manifest', {
      value: manifest,
      enumerable: false,
      configurable: false,
      writable: false,
    });

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

    Object.defineProperty(theme, 'varRef', {
      value: (tokenPath: string): string | undefined => {
        const varName = variableMap[tokenPath];
        if (varName) return `var(${varName})`;
        // Non-emitted scale: return raw value from nested theme
        const dotIdx = tokenPath.indexOf('.');
        if (dotIdx === -1) return undefined;
        const scale = tokenPath.slice(0, dotIdx);
        const key = tokenPath.slice(dotIdx + 1);
        const scaleObj = theme[scale];
        if (!isObject(scaleObj)) return undefined;
        const val = walkDotPath(scaleObj as Record<string, unknown>, key);
        return val !== undefined ? String(val) : undefined;
      },
      enumerable: false,
      configurable: false,
      writable: false,
    });

    return theme as BuiltTheme<T, Emitted>;
  }
}

type EmptyTheme = { breakpoints: Record<string, number> };

export function createTheme() {
  return new ThemeBuilder<EmptyTheme>(createState());
}

// ─── Build-Time Flatten Pass ──────────────────────────────

/** Token ref pattern: {scale.key} or {scale.key.sub} */
const TOKEN_REF_RE = /\{([^}]+)\}/g;

/**
 * Flatten the nested theme into dot-path keyed token map and CSS variable declarations.
 * This is the ONLY place where flattening happens.
 */
function flattenTheme(
  theme: Record<string, unknown>,
  emittedScales: Set<string>
): {
  tokenMap: Record<string, string>;
  variableMap: Record<string, string>;
  variables: Record<string, string>;
  modeVariables: Record<string, Record<string, string>>;
  modeTokens: Record<string, Record<string, string>>;
} {
  const tokenMap: Record<string, string> = {};
  const variableMap: Record<string, string> = {};
  const variables: Record<string, string> = {};
  const modeVariables: Record<string, Record<string, string>> = {};
  const modeTokens: Record<string, Record<string, string>> = {};

  // Flatten scales and colors
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

    const flat = flattenToDotPaths(scaleValue as Record<string, unknown>);
    const isEmitted = emittedScales.has(scaleName);

    for (const [dotKey, rawValue] of Object.entries(flat)) {
      const tokenPath = `${scaleName}.${dotKey}`;
      const dashKey = dotToDash(dotKey);
      const varName = `--${scaleName === 'colors' ? 'color' : scaleName}-${dashKey}`;

      if (isEmitted) {
        tokenMap[tokenPath] = `var(${varName})`;
        variableMap[tokenPath] = varName;
        variables[varName] = String(rawValue);
      } else {
        tokenMap[tokenPath] = String(rawValue);
      }
    }
  }

  // Flatten color modes
  if (
    theme.modes &&
    isObject(theme.modes) &&
    theme.colors &&
    isObject(theme.colors)
  ) {
    const flatColors = flattenToDotPaths(
      theme.colors as Record<string, unknown>
    );

    for (const [modeName, modeAliases] of Object.entries(
      theme.modes as Record<string, unknown>
    )) {
      if (!isObject(modeAliases)) continue;
      const flatAliases = flattenToDotPaths(
        modeAliases as Record<string, unknown>
      );
      const modeVars: Record<string, string> = {};
      const modeVals: Record<string, string> = {};

      for (const [aliasDotKey, colorRef] of Object.entries(flatAliases)) {
        if (typeof colorRef !== 'string') continue;
        const dashAlias = dotToDash(aliasDotKey);
        const varName = `--color-${dashAlias}`;

        // Resolve color ref to raw value via dot-path
        const rawValue = flatColors[colorRef as string];
        modeVals[`colors.${aliasDotKey}`] =
          rawValue !== undefined ? String(rawValue) : String(colorRef);
        modeVars[varName] =
          rawValue !== undefined ? String(rawValue) : String(colorRef);
      }

      modeVariables[modeName] = modeVars;
      modeTokens[modeName] = modeVals;
    }

    // Merge initial mode's semantic aliases into the main variables and tokenMap
    const initialMode = theme.mode as string;
    if (initialMode && modeVariables[initialMode]) {
      const initialModeVars: Record<string, string> = {};
      const flatInitialAliases = flattenToDotPaths(
        (theme.modes as Record<string, unknown>)[initialMode] as Record<
          string,
          unknown
        >
      );
      for (const [aliasDotKey, colorRef] of Object.entries(
        flatInitialAliases
      )) {
        if (typeof colorRef !== 'string') continue;
        const dashAlias = dotToDash(aliasDotKey);
        const varName = `--color-${dashAlias}`;
        // Semantic aliases point to the palette var, not the raw value
        const paletteVarName = variableMap[`colors.${colorRef}`];
        if (paletteVarName) {
          initialModeVars[varName] = `var(${paletteVarName})`;
        }
        // Add semantic aliases to tokenMap and variableMap
        tokenMap[`colors.${aliasDotKey}`] = `var(${varName})`;
        variableMap[`colors.${aliasDotKey}`] = varName;
      }
      Object.assign(variables, initialModeVars);
    }
  }

  return { tokenMap, variableMap, variables, modeVariables, modeTokens };
}

/**
 * Resolve token refs ({scale.key}) in all flattened token values.
 * Operates on the flattened tokenMap — does NOT mutate the nested theme.
 */
function resolveTokenRefs(
  tokenMap: Record<string, string>,
  variableMap: Record<string, string>,
  emittedScales: Set<string>
): void {
  for (const [tokenPath, value] of Object.entries(tokenMap)) {
    if (typeof value !== 'string') continue;
    if (!value.includes('{')) continue;

    // Don't resolve var() references — they're already resolved
    if (value.startsWith('var(')) continue;

    const scaleName = tokenPath.split('.')[0];

    const resolved = value.replace(TOKEN_REF_RE, (match, ref: string) => {
      // Check self-reference (same scale)
      const refScale = ref.split('.')[0];
      if (refScale === scaleName) {
        // biome-ignore lint/suspicious/noConsole: intentional runtime diagnostic
        console.warn(
          `[animus] Self-referential token ref {${ref}} in scale '${scaleName}' — skipped`
        );
        return match;
      }

      // Handle opacity syntax: {colors.key/opacity}
      let lookupPath = ref;
      let opacity: string | undefined;
      const slashIdx = ref.indexOf('/');
      if (slashIdx !== -1) {
        lookupPath = ref.slice(0, slashIdx);
        opacity = ref.slice(slashIdx + 1);
      }

      // Look up the referenced token
      const refValue = tokenMap[lookupPath];
      if (refValue === undefined) {
        // biome-ignore lint/suspicious/noConsole: intentional runtime diagnostic
        console.warn(
          `[animus] Token ref {${ref}} — path '${lookupPath}' not found in token map`
        );
        return match;
      }

      // Apply opacity modifier via color-mix
      if (opacity) {
        const alpha = Number.parseInt(opacity, 10);
        if (alpha === 0) return 'transparent';
        if (alpha !== 100) {
          return `color-mix(in srgb, ${refValue} ${alpha}%, transparent)`;
        }
      }

      return refValue;
    });

    if (resolved !== value) {
      tokenMap[tokenPath] = resolved;
    }
  }
}

/** Build CSS variable blocks from flattened data. */
function buildVariableCss(
  rootVariables: Record<string, string>,
  breakpointVariables: Record<string, string>,
  modeVariables: Record<string, Record<string, string>>
): string {
  const parts: string[] = [];

  // :root block
  const rootLines: string[] = [];
  for (const [varName, value] of Object.entries(rootVariables)) {
    rootLines.push(`  ${varName}: ${value};`);
  }
  for (const [varName, value] of Object.entries(breakpointVariables)) {
    rootLines.push(`  ${varName}: ${value};`);
  }
  if (rootLines.length > 0) {
    parts.push(`:root {\n${rootLines.join('\n')}\n}`);
  }

  // [data-color-mode] blocks
  for (const [modeName, modeVars] of Object.entries(modeVariables)) {
    const modeLines: string[] = [];
    for (const [varName, value] of Object.entries(modeVars)) {
      modeLines.push(`  ${varName}: ${value};`);
    }
    if (modeLines.length > 0) {
      parts.push(
        `[data-color-mode="${modeName}"] {\n${modeLines.join('\n')}\n}`
      );
    }
  }

  return parts.join('\n\n');
}
