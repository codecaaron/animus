interface VariantConfig {
  options: string[];
  default?: string;
}

interface CompoundConfig {
  conditions: Record<string, string | string[]>;
  className: string;
}

export interface ClassResolverConfig {
  variants?: Record<string, VariantConfig>;
  compounds?: CompoundConfig[];
  states?: string[];
  systemPropNames?: string[];
  customPropMap?: Record<string, Record<string, string>>;
  customDynamicConfig?: DynamicPropConfig;
  /** Callback props whose `customPropMap` keys are `typedValueKey`s. */
  typedCustomProps?: readonly string[];
}

export type SystemPropMap = Record<string, Record<string, string>>;

export type DynamicPropConfig = Record<
  string,
  {
    varName: string;
    slotClass: string;
    property?: string;
    properties?: readonly string[];
    /** The bound transform's readable name, for diagnostics. */
    transformName?: string;
    /** The bound definition's key in the generated `transforms` registry. */
    transformId?: string;
    transform?: (value: string | number) => string | number;
    scaleValues?: Record<string, string | number>;
    negative?: boolean;
    /** Values outside `scaleValues` are dropped, not applied raw. */
    strict?: boolean;
    /** The keywords a strict prop admits beside its tokens. */
    keywords?: readonly string[];
  }
>;

import { isUnitlessProperty } from '@animus-ui/properties';

import { IS_DEV } from './is-dev';
import { recordWitness } from './witness';

/**
 * A mixed property set resolves to unitless: a bare number on a length
 * property is dropped by the parser, `px` on a unitless one shifts layout.
 */
export function applyUnitFallback(
  value: string | number,
  cssProperties: readonly string[]
): string {
  if (typeof value === 'number') {
    if (cssProperties.some(isUnitlessProperty)) {
      return String(value);
    }
    return `${value}px`;
  }
  return String(value);
}

/**
 * The key format is fixed by the Rust css generator; a divergence here misses
 * every static class lookup.
 */
export function serializeValueKey(value: unknown): string {
  if (typeof value === 'number' || typeof value === 'string') {
    return String(value);
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return Object.keys(value)
      .sort()
      .map((k) => `${k}:${(value as Record<string, unknown>)[k]}`)
      .join('|');
  }
  return String(value);
}

/**
 * A callback can tell `100` from `"100"`, so its static classes are keyed by
 * type: a string is its JSON literal, a number its decimal text, a
 * responsive value `{…}` its `"breakpoint":key` entries in key order. Must
 * stay in step with the Rust css generator.
 */
function typedValueKey(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const entries = value as Record<string, unknown>;
    const pairs = Object.keys(entries)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${typedValueKey(entries[k])}`);
    return `{${pairs.join(',')}}`;
  }
  return String(value);
}

function isValidTransformResult(result: unknown): result is string | number {
  return (
    typeof result === 'string' ||
    (typeof result === 'number' && Number.isFinite(result))
  );
}

/**
 * The domain is results that failed `isValidTransformResult`; a valid string
 * or finite number passed here is mislabeled.
 */
export function describeResultShape(result: unknown): string {
  if (result === null) return 'null';
  if (Array.isArray(result)) return 'array';
  if (typeof result === 'number') return 'non-finite-number';
  return typeof result;
}

interface InvalidResult {
  shape: string;
}

interface TransformThrow {
  cause: unknown;
}

interface StrictScaleMiss {
  entry: unknown;
  breakpoint?: string;
}

type EntryFailure = InvalidResult | TransformThrow | StrictScaleMiss;

type DynamicEntryConfig = Pick<
  DynamicPropConfig[string],
  | 'varName'
  | 'property'
  | 'properties'
  | 'transform'
  | 'scaleValues'
  | 'negative'
  | 'strict'
  | 'keywords'
>;

function negateCssValue(css: string): string {
  if (css.includes('(')) return `calc(${css} * -1)`;
  if (css === '0' || css === '-0') return '0';
  if (css.startsWith('-')) return css.slice(1);
  return `-${css.startsWith('+') ? css.slice(1) : css}`;
}

/** A CSS `<number>`, exponent included. */
const CSS_NUMBER = String.raw`[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?`;
const CONTAINER_UNIT = new RegExp(
  `^${CSS_NUMBER}(?:cqw|cqi|cqh|cqb|cqmin|cqmax)$`
);
const SIZE_LENGTH = new RegExp(`^${CSS_NUMBER}(?:px|rem|vh|vw|vmax|vmin|%)$`);
const SIZE_PROPERTY =
  /^(?:left|right|top|bottom|inset|width|height)$|(?:Width|Height|-width|-height)$/;

/**
 * Values a strict prop's public type admits beside its tokens: zero, the
 * keywords extraction lists for its property, container units, token
 * references, and the lengths size properties take. Must stay in step with
 * the extractor's rule.
 */
function isAdmittedWithoutToken(
  value: unknown,
  dc: Pick<DynamicEntryConfig, 'property' | 'keywords'>
): boolean {
  if (typeof value === 'number') return value === 0;
  if (typeof value !== 'string') return true;
  return (
    value === '0' ||
    dc.keywords?.includes(value) === true ||
    value.includes('{') ||
    CONTAINER_UNIT.test(value) ||
    (dc.property !== undefined &&
      SIZE_PROPERTY.test(dc.property) &&
      (SIZE_LENGTH.test(value) || value.startsWith('calc(')))
  );
}

function resolveEntry(
  value: unknown,
  dc: DynamicEntryConfig
): string | EntryFailure {
  const key = String(value);
  let scaleResolved = dc.scaleValues?.[key];
  let negate = false;
  if (
    scaleResolved == null &&
    dc.negative &&
    typeof value === 'number' &&
    value < 0
  ) {
    scaleResolved = dc.scaleValues?.[String(-value)];
    negate = scaleResolved != null;
  }
  if (
    scaleResolved == null &&
    dc.strict &&
    dc.scaleValues &&
    !isAdmittedWithoutToken(value, dc)
  ) {
    return { entry: value };
  }
  const input = scaleResolved ?? value;
  let transformed: unknown = input;
  if (dc.transform) {
    try {
      transformed = dc.transform(input as string | number);
    } catch (cause) {
      return { cause };
    }
    if (!isValidTransformResult(transformed)) {
      return { shape: describeResultShape(transformed) };
    }
  }
  let css: string;
  if (typeof transformed === 'number') {
    const cssProperties =
      dc.properties && dc.properties.length > 0
        ? dc.properties
        : dc.property
          ? [dc.property]
          : [];
    css = applyUnitFallback(transformed, cssProperties);
  } else {
    css = String(transformed);
  }
  return negate ? negateCssValue(css) : css;
}

/**
 * `null` means the value missed a strict scale, or a configured transform
 * threw or returned neither a string nor a finite number.
 */
export function resolveValue(
  value: unknown,
  dc: DynamicEntryConfig
): string | null {
  const resolved = resolveEntry(value, dc);
  return typeof resolved === 'string' ? resolved : null;
}

export interface ClassResolution {
  classes: string[];
  dynamicStyle?: Record<string, string>;
  activeStates: string[];
}

const warnedDrops = new Set<string>();

function warnDroppedValue(
  baseClassName: string,
  propName: string,
  serializedValue: string,
  customOwned: boolean
): void {
  if (IS_DEV) {
    const dedupeKey = `${baseClassName}|${propName}`;
    if (warnedDrops.has(dedupeKey)) return;
    warnedDrops.add(dedupeKey);
    // Extraction gives a custom prop a runtime slot for its observed dynamic
    // values, spreads, forwarding wrappers and createElement renders; a
    // value without one is a literal the build saw, or arrived through an
    // alias it could not trace. Either way it drops without system rescue.
    // oxlint-disable-next-line no-console -- intentional runtime diagnostic
    console.warn(
      customOwned
        ? `[animus:drop] ${baseClassName}: value ${serializedValue} on custom prop '${propName}' is none of its extracted values and the prop has no runtime slot — it will not render. ` +
            `A literal missing from the prop's strict scale is reported by the build as animus.props.strict-token-miss; a value passed through an untraced alias is not.`
        : `[animus:drop] ${baseClassName}: value ${serializedValue} on prop '${propName}' matched no static class and no dynamic slot — it will not render. ` +
            `If this prop should accept runtime values, ensure its dynamic config is emitted.`
    );
  }
}

/**
 * A value taken from a variant default emits `--{prop}-default`, not the
 * value, so the compose override rule misses and the parent's value wins.
 */
function applyVariantClasses(
  classes: string[],
  baseClassName: string,
  props: Record<string, any>,
  config: ClassResolverConfig
): void {
  if (!config.variants) return;
  for (const [prop, vc] of Object.entries(config.variants)) {
    const value = props[prop] ?? vc.default;
    if (value != null) {
      const isDefault = !(prop in props) && vc.default != null;
      classes.push(
        `${baseClassName}--${prop}-${isDefault ? 'default' : value}`
      );
      recordWitness(baseClassName, prop, value, 'static');
    }
  }
}

function applyCompoundClasses(
  classes: string[],
  props: Record<string, any>,
  config: ClassResolverConfig
): void {
  if (!config.compounds) return;
  for (const compound of config.compounds) {
    let match = true;
    for (const [prop, expected] of Object.entries(compound.conditions)) {
      const current = props[prop] ?? config.variants?.[prop]?.default;
      if (
        Array.isArray(expected)
          ? !expected.includes(current)
          : current !== expected
      ) {
        match = false;
        break;
      }
    }
    if (match) {
      classes.push(compound.className);
    }
  }
}

function applyStateClasses(
  classes: string[],
  baseClassName: string,
  props: Record<string, any>,
  config: ClassResolverConfig,
  activeStates: string[]
): void {
  if (!config.states) return;
  for (const state of config.states) {
    if (props[state]) {
      classes.push(`${baseClassName}--${state}`);
      activeStates.push(state);
      recordWitness(baseClassName, state, 'true', 'static');
    }
  }
}

const warnedInvalidResults = new Set<string>();

function warnInvalidTransformResult(
  baseClassName: string,
  propName: string,
  shape: string
): void {
  if (IS_DEV) {
    const dedupeKey = `${baseClassName}|${propName}`;
    if (warnedInvalidResults.has(dedupeKey)) return;
    warnedInvalidResults.add(dedupeKey);
    // oxlint-disable-next-line no-console -- intentional runtime diagnostic
    console.warn(
      `[animus:drop] ${baseClassName}: transform for prop '${propName}' returned ${shape} — expected string or finite number; value dropped`
    );
  }
}

const warnedThrows = new Set<string>();
const warnedStrictMisses = new Set<string>();

/** Keyed by value, like a throw: each rejected input is reported once. */
function warnStrictScaleMiss(
  baseClassName: string,
  propName: string,
  serializedValue: string,
  miss: StrictScaleMiss
): void {
  if (IS_DEV) {
    const dedupeKey = `${baseClassName}|${propName}|${serializedValue}`;
    if (warnedStrictMisses.has(dedupeKey)) return;
    warnedStrictMisses.add(dedupeKey);
    const entry =
      miss.breakpoint === undefined
        ? ''
        : ` (${String(miss.entry)} at ${miss.breakpoint})`;
    // oxlint-disable-next-line no-console -- intentional runtime diagnostic
    console.warn(
      `[animus:drop] ${baseClassName}: value ${serializedValue} on prop '${propName}' is not a token of its strict scale${entry}; prop styling dropped`
    );
  }
}

function describeThrown(cause: unknown): string {
  try {
    return String(cause);
  } catch {
    return 'unprintable thrown value';
  }
}

/**
 * Read as a string so the console never inspects the thrown value itself; a
 * hostile object could rethrow from an inspecting formatter.
 */
function thrownStack(cause: unknown): string | undefined {
  try {
    if (!(cause instanceof Error)) return undefined;
    const stack: unknown = cause.stack;
    return typeof stack === 'string' ? stack : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Keyed by value as well as prop: each distinct rejected input is reported
 * once, so the warning never names a stale value.
 */
function warnTransformThrow(
  baseClassName: string,
  propName: string,
  transformName: string | undefined,
  serializedValue: string,
  cause: unknown
): void {
  if (IS_DEV) {
    const dedupeKey = `${baseClassName}|${propName}|${serializedValue}`;
    if (warnedThrows.has(dedupeKey)) return;
    warnedThrows.add(dedupeKey);
    const transform = transformName
      ? `transform '${transformName}'`
      : 'inline transform';
    const stack = thrownStack(cause);
    // oxlint-disable-next-line no-console -- intentional runtime diagnostic
    console.warn(
      `[animus:drop] ${baseClassName}: ${transform} for prop '${propName}' threw for value ${serializedValue} (${describeThrown(cause)}); prop styling dropped`,
      ...(stack ? [stack] : [])
    );
  }
}

/**
 * Resolution is staged so a drop is atomic: one entry that misses a strict
 * scale, or one transform that throws or returns an invalid result, leaves
 * `classes` and `dynStyle` untouched.
 */
function applyDynamicProp(
  classes: string[],
  dynStyle: Record<string, string>,
  propValue: unknown,
  dc: DynamicPropConfig[string]
): EntryFailure | null {
  const staged: [slotClass: string, varName: string, resolved: string][] = [];
  if (
    typeof propValue === 'object' &&
    propValue !== null &&
    !Array.isArray(propValue)
  ) {
    for (const [bp, bpVal] of Object.entries(propValue)) {
      if (bpVal == null) continue;
      const resolved = resolveEntry(bpVal, dc);
      if (typeof resolved !== 'string') {
        return 'entry' in resolved ? { ...resolved, breakpoint: bp } : resolved;
      }
      staged.push(
        bp === '_'
          ? [dc.slotClass, dc.varName, resolved]
          : [`${dc.slotClass}-${bp}`, `${dc.varName}-${bp}`, resolved]
      );
    }
  } else {
    const resolved = resolveEntry(propValue, dc);
    if (typeof resolved !== 'string') return resolved;
    staged.push([dc.slotClass, dc.varName, resolved]);
  }
  for (const [slotClass, varName, resolved] of staged) {
    classes.push(slotClass);
    dynStyle[varName] = resolved;
  }
  return null;
}

export function resolveClasses(
  baseClassName: string,
  props: Record<string, any>,
  config: ClassResolverConfig,
  systemPropMap?: SystemPropMap,
  dynamicPropConfig?: DynamicPropConfig
): ClassResolution {
  const classes = [baseClassName];
  let dynStyle: Record<string, string> | undefined;

  applyVariantClasses(classes, baseClassName, props, config);

  applyCompoundClasses(classes, props, config);

  const activeStates: string[] = [];
  applyStateClasses(classes, baseClassName, props, config, activeStates);

  const systemPropNames = config.systemPropNames || [];
  if (systemPropNames.length > 0) {
    const { customPropMap, customDynamicConfig } = config;

    for (const propName of systemPropNames) {
      if (!(propName in props)) continue;
      const propValue = props[propName];
      if (propValue == null) continue;

      const key = serializeValueKey(propValue);
      // A custom prop resolves only through its own config, so a same-named
      // system class or slot cannot apply a value that config rejects.
      const customOwned =
        customPropMap?.[propName] !== undefined ||
        customDynamicConfig?.[propName] !== undefined;
      const cls = customOwned
        ? customPropMap?.[propName]?.[
            config.typedCustomProps?.includes(propName)
              ? typedValueKey(propValue)
              : key
          ]
        : systemPropMap?.[propName]?.[key];

      if (cls) {
        classes.push(cls);
        recordWitness(baseClassName, propName, key, 'static');
      } else {
        const dc = customOwned
          ? customDynamicConfig?.[propName]
          : dynamicPropConfig?.[propName];

        if (dc) {
          // Witness only once the whole value applies: a dropped value
          // witnesses as `drop`, never `dynamic`. dynStyle adopts on success.
          const staged = dynStyle ?? {};
          const failure = applyDynamicProp(classes, staged, propValue, dc);
          if (failure === null) {
            dynStyle = staged;
            recordWitness(baseClassName, propName, key, 'dynamic');
          } else {
            if ('shape' in failure) {
              warnInvalidTransformResult(
                baseClassName,
                propName,
                failure.shape
              );
            } else if ('entry' in failure) {
              warnStrictScaleMiss(baseClassName, propName, key, failure);
            } else {
              warnTransformThrow(
                baseClassName,
                propName,
                dc.transformName,
                key,
                failure.cause
              );
            }
            recordWitness(baseClassName, propName, key, 'drop');
          }
        } else {
          warnDroppedValue(baseClassName, propName, key, customOwned);
          recordWitness(baseClassName, propName, key, 'drop');
        }
      }
    }
  }

  return { classes, dynamicStyle: dynStyle, activeStates };
}
