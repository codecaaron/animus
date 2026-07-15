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
  if (config.variants) {
    for (const [prop, vc] of Object.entries(config.variants)) {
      const value = props[prop] ?? vc.default;
      if (value != null) {
        // When value comes from defaultVariant fallback (prop not passed),
        // emit --{prop}-default instead of --{prop}-{value}. This prevents
        // the compose override rule from matching, allowing inheritance
        // from the parent to take precedence.
        const isDefault = !(prop in props) && vc.default != null;
        classes.push(
          `${baseClassName}--${prop}-${isDefault ? 'default' : value}`
        );
        recordWitness(baseClassName, prop, value, 'static');
      }
    }
  }

  // Apply compound classes
  if (config.compounds) {
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

  // Apply state classes and track active states for data-attribute passthrough
  const activeStates: string[] = [];
  if (config.states) {
    for (const state of config.states) {
      if (props[state]) {
        classes.push(`${baseClassName}--${state}`);
        activeStates.push(state);
        recordWitness(baseClassName, state, 'true', 'static');
      }
    }
  }

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

          if (
            typeof propValue === 'object' &&
            propValue !== null &&
            !Array.isArray(propValue)
          ) {
            for (const [bp, bpVal] of Object.entries(propValue)) {
              if (bpVal == null) continue;
              if (bp === '_') {
                classes.push(dc.slotClass);
                const finalVal = resolveValue(bpVal, dc);
                dynStyle[dc.varName] = finalVal;
              } else {
                classes.push(`${dc.slotClass}-${bp}`);
                const varName = `${dc.varName}-${bp}`;
                const finalVal = resolveValue(bpVal, dc);
                dynStyle[varName] = finalVal;
              }
            }
          } else {
            classes.push(dc.slotClass);
            const finalVal = resolveValue(propValue, dc);
            dynStyle[dc.varName] = finalVal;
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
