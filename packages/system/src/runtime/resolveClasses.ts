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
}

export type SystemPropMap = Record<string, Record<string, string>>;

export type DynamicPropConfig = Record<
  string,
  {
    varName: string;
    slotClass: string;
    property?: string;
    properties?: readonly string[];
    transformName?: string;
    transform?: (value: string | number) => string | number;
    scaleValues?: Record<string, string>;
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

function resolveEntry(
  value: unknown,
  dc: Pick<
    DynamicPropConfig[string],
    'varName' | 'property' | 'properties' | 'transform' | 'scaleValues'
  >
): string | InvalidResult {
  const key = String(value);
  const scaleResolved = dc.scaleValues?.[key];
  if (scaleResolved != null) {
    const transformed = dc.transform
      ? dc.transform(scaleResolved)
      : scaleResolved;
    if (dc.transform && !isValidTransformResult(transformed)) {
      return { shape: describeResultShape(transformed) };
    }
    return String(transformed);
  }
  const transformed = dc.transform
    ? dc.transform(value as string | number)
    : value;
  if (dc.transform && !isValidTransformResult(transformed)) {
    return { shape: describeResultShape(transformed) };
  }
  if (typeof transformed !== 'number') return String(transformed);
  const cssProperties =
    dc.properties && dc.properties.length > 0
      ? dc.properties
      : dc.property
        ? [dc.property]
        : [];
  return applyUnitFallback(transformed, cssProperties);
}

/**
 * `null` means a configured transform returned neither a string nor a finite
 * number; paths without a transform never return `null`.
 */
export function resolveValue(
  value: unknown,
  dc: Pick<
    DynamicPropConfig[string],
    'varName' | 'property' | 'properties' | 'transform' | 'scaleValues'
  >
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
  serializedValue: string
): void {
  if (IS_DEV) {
    const dedupeKey = `${baseClassName}|${propName}`;
    if (warnedDrops.has(dedupeKey)) return;
    warnedDrops.add(dedupeKey);
    // oxlint-disable-next-line no-console -- intentional runtime diagnostic
    console.warn(
      `[animus:drop] ${baseClassName}: value ${serializedValue} on prop '${propName}' matched no static class and no dynamic slot — it will not render. ` +
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

/**
 * Resolution is staged so a drop is atomic: one invalid transform result
 * anywhere leaves `classes` and `dynStyle` untouched.
 */
function applyDynamicProp(
  classes: string[],
  dynStyle: Record<string, string>,
  propValue: unknown,
  dc: DynamicPropConfig[string]
): InvalidResult | null {
  const staged: [slotClass: string, varName: string, resolved: string][] = [];
  if (
    typeof propValue === 'object' &&
    propValue !== null &&
    !Array.isArray(propValue)
  ) {
    for (const [bp, bpVal] of Object.entries(propValue)) {
      if (bpVal == null) continue;
      const resolved = resolveEntry(bpVal, dc);
      if (typeof resolved !== 'string') return resolved;
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
      const cls =
        customPropMap?.[propName]?.[key] ?? systemPropMap?.[propName]?.[key];

      if (cls) {
        classes.push(cls);
        recordWitness(baseClassName, propName, key, 'static');
      } else {
        const dc =
          customDynamicConfig?.[propName] ?? dynamicPropConfig?.[propName];

        if (dc) {
          // Witness only once the whole value applies: a dropped value
          // witnesses as `drop`, never `dynamic`. dynStyle adopts on success.
          const staged = dynStyle ?? {};
          const invalid = applyDynamicProp(classes, staged, propValue, dc);
          if (invalid === null) {
            dynStyle = staged;
            recordWitness(baseClassName, propName, key, 'dynamic');
          } else {
            warnInvalidTransformResult(baseClassName, propName, invalid.shape);
            recordWitness(baseClassName, propName, key, 'drop');
          }
        } else {
          warnDroppedValue(baseClassName, propName, key);
          recordWitness(baseClassName, propName, key, 'drop');
        }
      }
    }
  }

  return { classes, dynamicStyle: dynStyle, activeStates };
}
