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
    transformName?: string;
    transform?: (value: string | number) => string | number;
    scaleValues?: Record<string, string>;
  }
>;

import { UNITLESS_PROPERTIES } from '@animus-ui/properties';

import { recordWitness } from './witness';

/**
 * Apply unit fallback to a value for a given CSS property.
 */
export function applyUnitFallback(
  value: string | number,
  cssProperty: string
): string {
  if (typeof value === 'number') {
    if (UNITLESS_PROPERTIES.has(cssProperty)) {
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
 * Resolve a dynamic prop value through scale lookup → transform → unit fallback.
 */
export function resolveValue(
  value: unknown,
  dc: {
    varName: string;
    transform?: (value: string | number) => string | number;
    scaleValues?: Record<string, string>;
  }
): string {
  const key = String(value);
  const scaleResolved = dc.scaleValues?.[key];
  if (scaleResolved != null) {
    const transformed = dc.transform
      ? dc.transform(scaleResolved)
      : scaleResolved;
    return String(transformed);
  }
  const transformed = dc.transform
    ? dc.transform(value as string | number)
    : value;
  return applyUnitFallback(transformed as string | number, dc.varName);
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
  if (
    typeof process !== 'undefined' &&
    process.env?.NODE_ENV !== 'production'
  ) {
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

/**
 * Expand a resolved dynamic prop into slot classes and CSS-variable style
 * entries. Responsive objects expand per breakpoint: the `_` base breakpoint
 * uses the bare slotClass and varName; named breakpoints suffix both
 * (`${slotClass}-${bp}` and `${varName}-${bp}`). Scalar values push the bare
 * slotClass and set varName directly. Mutates `classes` (push order preserved)
 * and `dynStyle` in place; the caller records the dynamic witness beforehand.
 */
function applyDynamicProp(
  classes: string[],
  dynStyle: Record<string, string>,
  propValue: unknown,
  dc: DynamicPropConfig[string]
): void {
  if (
    typeof propValue === 'object' &&
    propValue !== null &&
    !Array.isArray(propValue)
  ) {
    for (const [bp, bpVal] of Object.entries(propValue)) {
      if (bpVal == null) continue;
      if (bp === '_') {
        classes.push(dc.slotClass);
        dynStyle[dc.varName] = resolveValue(bpVal, dc);
      } else {
        classes.push(`${dc.slotClass}-${bp}`);
        dynStyle[`${dc.varName}-${bp}`] = resolveValue(bpVal, dc);
      }
    }
  } else {
    classes.push(dc.slotClass);
    dynStyle[dc.varName] = resolveValue(propValue, dc);
  }
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
          recordWitness(baseClassName, propName, key, 'dynamic');
          if (!dynStyle) dynStyle = {};
          applyDynamicProp(classes, dynStyle, propValue, dc);
        } else {
          warnDroppedValue(baseClassName, propName, key);
          recordWitness(baseClassName, propName, key, 'drop');
        }
      }
    }
  }

  return { classes, dynamicStyle: dynStyle, activeStates };
}
