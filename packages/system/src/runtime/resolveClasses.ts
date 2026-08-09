/**
 * Shared className resolution logic used by both createComponent (React)
 * and createClassResolver (framework-agnostic).
 *
 * Factored to ensure behavioral parity between .asElement() and .asClass() outputs.
 */

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
    /** CSS property the slot class declares — the unit-fallback decision. */
    property?: string;
    /** Member properties when the prop expands to several declarations. */
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
 * Apply unit fallback to a value for the CSS properties the value lands on.
 * `isUnitlessProperty` owns the spelling question, so either convention works.
 *
 * A mixed property set resolves to unitless: an unsuffixed number on a length
 * property is dropped by the CSS parser, whereas `px` on a unitless property
 * renders and silently changes layout — prefer the drop.
 *
 * An empty property list keeps the unconditional `px` — configs emitted before
 * `property` was carried name no property at all.
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
 * Serialize a system prop value to a lookup key matching the Rust
 * css_generator's serialize_value_key output format.
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
 * Validity predicate for transform results (design D5): only strings and
 * finite numbers may reach the stylesheet. The gate applies solely where a
 * configured transform ran — scale hits without a transform are exempt.
 */
function isValidTransformResult(result: unknown): result is string | number {
  return (
    typeof result === 'string' ||
    (typeof result === 'number' && Number.isFinite(result))
  );
}

/**
 * Shape descriptor for an invalid transform result, shared by the drop
 * warning and its tests. `null` and arrays are named before `typeof` would
 * fold them into `object`; non-finite numbers get their own name because
 * finite ones are valid. Precondition: callers pass only results that failed
 * `isValidTransformResult` — valid strings/finite numbers are out of domain
 * and would be mislabeled.
 */
export function describeResultShape(result: unknown): string {
  if (result === null) return 'null';
  if (Array.isArray(result)) return 'array';
  if (typeof result === 'number') return 'non-finite-number';
  return typeof result;
}

/** Failure from a single entry resolution: the offending result's shape. */
interface InvalidResult {
  shape: string;
}

/**
 * Resolve one entry through scale lookup → transform → unit fallback,
 * validating the transform result in both the scale-resolved and raw arms.
 * An invalid result yields its shape descriptor instead of a string.
 */
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
  // The CSS properties the slot class declares: the member list when the prop
  // expands to several declarations, otherwise the single property — mirroring
  // the slot-class emitter. Built only for numbers, the sole values a unit
  // fallback can move.
  const cssProperties =
    dc.properties && dc.properties.length > 0
      ? dc.properties
      : dc.property
        ? [dc.property]
        : [];
  return applyUnitFallback(transformed, cssProperties);
}

/**
 * Resolve a dynamic prop value through scale lookup → transform → unit
 * fallback. Returns `null` when a configured transform produced an invalid
 * result (anything but a string or finite number); no-transform paths never
 * return `null`.
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
 * Apply variant classes in declaration order, recording a static witness per
 * resolved variant. When a value comes from a defaultVariant fallback (prop not
 * passed), emit --{prop}-default instead of --{prop}-{value} so the compose
 * override rule cannot match, allowing inheritance from the parent to win.
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

/**
 * Apply compound classes: push each compound's className when every condition
 * matches (against the prop value or its variant default). No witness records.
 */
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

/**
 * Apply state classes and track active states for data-attribute passthrough,
 * recording a static witness per active state.
 */
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
 * Expand a resolved dynamic prop into slot classes and CSS-variable style
 * entries. Responsive objects expand per breakpoint: the `_` base breakpoint
 * uses the bare slotClass and varName; named breakpoints suffix both
 * (`${slotClass}-${bp}` and `${varName}-${bp}`). Scalar values push the bare
 * slotClass and set varName directly.
 *
 * Two-phase so the drop is atomic: every entry resolves into a staging list
 * before any mutation. One invalid transform result anywhere — the scalar, or
 * any single breakpoint — returns that failure (first offending shape) with
 * `classes` and `dynStyle` untouched. On success the staged entries apply in
 * the pre-existing push order and the function returns `null`; the caller
 * records the witness from the outcome.
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

/**
 * Resolve className parts from props, using extracted configuration.
 * This is the shared logic between createComponent and createClassResolver.
 */
export function resolveClasses(
  baseClassName: string,
  props: Record<string, any>,
  config: ClassResolverConfig,
  systemPropMap?: SystemPropMap,
  dynamicPropConfig?: DynamicPropConfig
): ClassResolution {
  const classes = [baseClassName];
  let dynStyle: Record<string, string> | undefined;

  // Apply variant classes
  applyVariantClasses(classes, baseClassName, props, config);

  // Apply compound classes
  applyCompoundClasses(classes, props, config);

  // Apply state classes and track active states for data-attribute passthrough
  const activeStates: string[] = [];
  applyStateClasses(classes, baseClassName, props, config, activeStates);

  // Apply system prop utility classes from shared map
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
          // Witness only after the whole value applied — a dropped value must
          // witness as `drop`, never `dynamic`. The staging target is adopted
          // as dynStyle only on success, so a FAILED first prop cannot leave
          // an empty `{}` behind (a successful all-skipped responsive value
          // still adopts `{}`, matching pre-gate behavior). When dynStyle
          // already exists, `staged` aliases it — phase-1-only resolution in
          // applyDynamicProp is what keeps a later prop's failure from
          // touching an earlier prop's applied entries (pinned by the
          // two-prop pair tests).
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
