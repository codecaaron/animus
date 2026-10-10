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
  /** System props bound to a configured transform, whose `systemPropMap`
   *  keys are `typedValueKey`s. */
  typedSystemProps?: readonly string[];
}

export type SystemPropMap = Record<string, Record<string, string>>;

interface ValueDynamicPropConfig {
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
  /** The custom property the prop's slot also writes. */
  currentVar?: string;
  kind?: never;
}

interface DeclarationDynamicPropConfig {
  kind: 'declarations';
  slotClass: string;
  /** Member property → its variable; a breakpoint appends `-{bp}`. */
  memberVars: Record<string, string>;
  /** Scale key → member property → resolved CSS value. */
  declarationScaleValues: Record<string, Record<string, string>>;
}

type DeclarationConfig = DeclarationDynamicPropConfig & {
  [K in Exclude<keyof ValueDynamicPropConfig, 'kind' | 'slotClass'>]?: never;
};

export type DynamicPropConfig = Record<
  string,
  ValueDynamicPropConfig | DeclarationConfig
>;

import {
  componentValues,
  decodedIdentifier,
  importantPriority,
  isUnitlessProperty,
  tokenize,
  variableReads,
} from '@animus-ui/properties';

import { IS_DEV } from './is-dev';
import { recordWitness } from './witness';

/** Whether a property set is custom properties only, which read a value as
 *  written: no unit, and a trailing `!` that is no priority. */
function isCustomOnly(cssProperties: readonly string[]): boolean {
  return (
    cssProperties.length > 0 &&
    cssProperties.every((property) => property.startsWith('--'))
  );
}

/** The properties a slot's value is written to. */
function slotProperties(
  dc: Pick<ValueDynamicPropConfig, 'property' | 'properties'>
): readonly string[] {
  return dc.properties && dc.properties.length > 0
    ? dc.properties
    : dc.property
      ? [dc.property]
      : [];
}

/**
 * A responsive value's entries by breakpoint, or a bare value at `_`. The
 * value arrives without nullish breakpoints (`withoutAbsentBreakpoints`).
 */
function responsiveEntries(
  propValue: unknown
): [responsive: boolean, entries: [breakpoint: string, value: unknown][]] {
  const responsive =
    typeof propValue === 'object' &&
    propValue !== null &&
    !Array.isArray(propValue);
  return [
    responsive,
    responsive ? Object.entries(propValue) : [['_', propValue]],
  ];
}

/**
 * A mixed property set resolves to unitless: a bare number on a length
 * property is dropped by the parser, `px` on a unitless one shifts layout.
 * Custom properties have no unit context, so a set of only those keeps the
 * number as written, as the static path does.
 */
export function applyUnitFallback(
  value: string | number,
  cssProperties: readonly string[]
): string {
  if (typeof value === 'number') {
    if (isCustomOnly(cssProperties) || cssProperties.some(isUnitlessProperty)) {
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
 * A callback, inline or configured, can tell `100` from `"100"`, so its static classes are keyed by
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
  ValueDynamicPropConfig,
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

/** A CSS-wide keyword is a cascade instruction, not a value: no transform
 *  sees it, and through an inline variable it would act on the variable. */
const CSS_WIDE_KEYWORDS: ReadonlySet<unknown> = new Set([
  'initial',
  'inherit',
  'unset',
  'revert',
  'revert-layer',
]);

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
  // A scale key spelled like a keyword resolved above, as a token.
  const keyword = scaleResolved == null && CSS_WIDE_KEYWORDS.has(value);
  if (dc.transform && !keyword) {
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
    css = applyUnitFallback(transformed, slotProperties(dc));
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
 * An explicit `undefined` takes the default as an omitted prop does.
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
      const isDefault = props[prop] == null && vc.default != null;
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

const warnedImportant = new Set<string>();

/** Keyed by value: each runtime value that loses `!important` is reported once. */
function warnIgnoredImportant(
  baseClassName: string,
  propName: string,
  value: string
): void {
  if (IS_DEV) {
    const dedupeKey = `${baseClassName}|${propName}|${value}`;
    if (warnedImportant.has(dedupeKey)) return;
    warnedImportant.add(dedupeKey);
    // oxlint-disable-next-line no-console -- intentional runtime diagnostic
    console.warn(
      `[animus:important] ${baseClassName}: !important is ignored on the runtime-generated value ${JSON.stringify(value)} of prop '${propName}' — a runtime value reaches CSS through a variable, which cannot carry it; declare the value literally to keep !important`
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
 * Whether `resolved` reads `currentVar` through a `var()` at any depth, its
 * fallbacks included: a function token whose decoded name is `var` in any
 * case, with the decoded variable name as its first argument. Comments,
 * quoted strings and `url()` read nothing. The extractor's static path skips
 * its `currentVar` write by the same predicate.
 */
function readsCurrentVar(resolved: string, currentVar: string): boolean {
  if (!resolved.includes('(')) return false;
  const destination = decodedIdentifier(currentVar);
  return variableReads(componentValues(tokenize(resolved))).some(
    (read) => read.name === destination
  );
}

/**
 * A value that reads the prop's own `currentVar` takes the slot that leaves
 * it alone, since writing it would make the variable cyclic.
 */
function slotClassFor(dc: ValueDynamicPropConfig, resolved: string): string {
  return dc.currentVar !== undefined && readsCurrentVar(resolved, dc.currentVar)
    ? `${dc.slotClass}--keep`
    : dc.slotClass;
}

/**
 * Resolution is staged so a drop is atomic: one entry that misses a strict
 * scale, or one transform that throws or returns an invalid result, leaves
 * `classes` and `dynStyle` untouched. A responsive entry that is a CSS-wide
 * keyword takes the class extraction emits for it at that breakpoint.
 *
 * A slot is a CSS variable, which cannot carry `!important`. A literal that
 * carries it, at a breakpoint, takes the class extraction emits for every
 * literal branch it reads; a bare literal's class the caller already found.
 * Any other value is runtime-generated: it resolves as at build time, where
 * a trailing `!` is ` !important`, and the slot takes the result without the
 * priority, which `ignoredImportant` hears of. Where only custom properties
 * read the value, a trailing `!` is no priority, as at build time.
 */
function applyDynamicProp(
  classes: string[],
  dynStyle: Record<string, string>,
  propValue: unknown,
  dc: ValueDynamicPropConfig,
  literalClass: (value: unknown) => string | undefined,
  ignoredImportant: (value: string) => void
): EntryFailure | null {
  const staged: [cls: string, varName?: string, resolved?: string][] = [];
  const [responsive, entries] = responsiveEntries(propValue);
  const lookup = (bp: string, value: unknown) =>
    literalClass(bp === '_' ? value : { [bp]: value });
  for (const [bp, authored] of entries) {
    let value = authored;
    // The authored text, when its priority cannot reach the slot.
    let ignored: string | undefined;
    const priority =
      typeof authored === 'string' ? importantPriority(authored) : undefined;
    if (
      typeof authored === 'string' &&
      priority &&
      (priority.spelling === 'important' || !isCustomOnly(slotProperties(dc)))
    ) {
      const literal = responsive ? lookup(bp, authored) : undefined;
      if (literal) {
        staged.push([literal]);
        continue;
      }
      ignored = authored;
      if (priority.spelling === 'shorthand') {
        value = `${authored.slice(0, priority.end)} !important`;
      }
    }
    const keywordClass =
      responsive && CSS_WIDE_KEYWORDS.has(value)
        ? lookup(bp, value)
        : undefined;
    if (keywordClass) {
      staged.push([keywordClass]);
      continue;
    }
    let resolved = resolveEntry(value, dc);
    if (typeof resolved !== 'string') {
      return 'entry' in resolved && responsive
        ? { ...resolved, breakpoint: bp }
        : resolved;
    }
    if (ignored !== undefined) {
      ignoredImportant(ignored);
      const end = importantPriority(resolved)?.end;
      resolved = end === undefined ? resolved : resolved.slice(0, end);
      const bareKeyword = CSS_WIDE_KEYWORDS.has(resolved)
        ? lookup(bp, resolved)
        : undefined;
      if (bareKeyword) {
        staged.push([bareKeyword]);
        continue;
      }
    }
    const slotClass = slotClassFor(dc, resolved);
    staged.push(
      bp === '_'
        ? [slotClass, dc.varName, resolved]
        : [`${slotClass}-${bp}`, `${dc.varName}-${bp}`, resolved]
    );
  }
  for (const [cls, varName, resolved] of staged) {
    classes.push(cls);
    if (varName !== undefined && resolved !== undefined) {
      dynStyle[varName] = resolved;
    }
  }
  return null;
}

/**
 * A declaration prop writes every member of the selected record. The base
 * consuming class applies whenever the prop applies, so a value without a
 * base key reads the base member variables an ancestor wrote, or else leaves
 * lower layers in force. A key outside the scale drops the whole value.
 */
function applyDeclarationProp(
  classes: string[],
  dynStyle: Record<string, string>,
  propValue: unknown,
  dc: DeclarationDynamicPropConfig
): StrictScaleMiss | null {
  const records = dc.declarationScaleValues;
  const memberVars = Object.entries(dc.memberVars);
  const [responsive, entries] = responsiveEntries(propValue);
  const staged: [breakpoint: string, record: Record<string, string>][] = [];
  for (const [breakpoint, value] of entries) {
    const key = String(value);
    if (!Object.prototype.hasOwnProperty.call(records, key)) {
      return responsive ? { entry: value, breakpoint } : { entry: value };
    }
    staged.push([breakpoint, records[key]]);
  }
  if (staged.length === 0) return null;
  classes.push(dc.slotClass);
  for (const [breakpoint, record] of staged) {
    const suffix = breakpoint === '_' ? '' : `-${breakpoint}`;
    if (suffix) classes.push(`${dc.slotClass}${suffix}`);
    for (const [member, varName] of memberVars) {
      dynStyle[`${varName}${suffix}`] = record[member];
    }
  }
  return null;
}

/**
 * A responsive value without its nullish breakpoints, so it keys the same
 * static class as the value written without them; `undefined` when none
 * remain, as if the prop were omitted.
 */
function withoutAbsentBreakpoints(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value;
  }
  const entries = Object.entries(value);
  if (entries.every(([, entry]) => entry != null)) return value;
  const present = entries.filter(([, entry]) => entry != null);
  return present.length > 0 ? Object.fromEntries(present) : undefined;
}

/**
 * The config with each admitted prop named once, at its first position. An
 * extracted config lists every admitted group's props, and groups can share
 * one, as flexbox and grid share `alignItems`.
 */
export function withUniqueSystemPropNames(
  config: ClassResolverConfig
): ClassResolverConfig {
  const names = config.systemPropNames;
  if (!names) return config;
  const unique = [...new Set(names)];
  return unique.length === names.length
    ? config
    : { ...config, systemPropNames: unique };
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
      const propValue = withoutAbsentBreakpoints(props[propName]);
      if (propValue == null) continue;

      const key = serializeValueKey(propValue);
      // A custom prop resolves only through its own config, so a same-named
      // system class or slot cannot apply a value that config rejects.
      const customOwned =
        customPropMap?.[propName] !== undefined ||
        customDynamicConfig?.[propName] !== undefined;
      const [classMap, typedProps] = customOwned
        ? [customPropMap, config.typedCustomProps]
        : [systemPropMap, config.typedSystemProps];
      const typed = typedProps?.includes(propName) === true;
      const cls =
        classMap?.[propName]?.[typed ? typedValueKey(propValue) : key];

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
          const failure =
            dc.kind === 'declarations'
              ? applyDeclarationProp(classes, staged, propValue, dc)
              : applyDynamicProp(
                  classes,
                  staged,
                  propValue,
                  dc,
                  (value) =>
                    classMap?.[propName]?.[
                      (typed ? typedValueKey : serializeValueKey)(value)
                    ],
                  (value) =>
                    warnIgnoredImportant(baseClassName, propName, value)
                );
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
