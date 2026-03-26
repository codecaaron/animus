import type { ForwardedRef } from 'react';
import { createElement, forwardRef, useRef } from 'react';

interface VariantConfig {
  options: string[];
  default?: string;
}

interface ComponentConfig {
  variants?: Record<string, VariantConfig>;
  states?: string[];
  systemPropNames?: string[];
  customPropMap?: Record<string, Record<string, string>>;
  customDynamicConfig?: DynamicPropConfig;
}

type SystemPropMap = Record<string, Record<string, string>>;

type DynamicPropConfig = Record<
  string,
  {
    varName: string;
    slotClass: string;
    transformName?: string;
    transform?: (value: string | number) => string | number;
    scaleValues?: Record<string, string>;
  }
>;

// Accept either an HTML tag string or a React component reference.
// React.createElement handles both transparently.
type ElementType = string | React.ComponentType<any>;

type AnimusComponent = ReturnType<typeof forwardRef> & {
  extend: () => never;
};

/**
 * CSS properties that accept unitless numeric values.
 * Bare numerics on properties NOT in this set receive `px`.
 * Matches @emotion/unitless and React DOM's style handling.
 */
const UNITLESS_PROPERTIES = new Set([
  'animation-iteration-count',
  'border-image-outset',
  'border-image-slice',
  'border-image-width',
  'box-flex',
  'box-flex-group',
  'box-ordinal-group',
  'column-count',
  'columns',
  'flex',
  'flex-grow',
  'flex-positive',
  'flex-shrink',
  'flex-negative',
  'flex-order',
  'font-weight',
  'grid-area',
  'grid-column',
  'grid-column-end',
  'grid-column-span',
  'grid-column-start',
  'grid-row',
  'grid-row-end',
  'grid-row-span',
  'grid-row-start',
  'line-clamp',
  'line-height',
  'opacity',
  'order',
  'orphans',
  'tab-size',
  'widows',
  'z-index',
  'zoom',
  'fill-opacity',
  'flood-opacity',
  'stop-opacity',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-miterlimit',
  'stroke-opacity',
  'stroke-width',
]);

/**
 * Apply unit fallback to a value for a given CSS property.
 * Unitless numeric values on properties that expect length units receive `px`.
 */
function applyUnitFallback(
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
 * css_generator's serialize_value_key output format:
 * - Numbers and strings → their string representation
 * - Responsive objects → sorted "key:value" pairs joined by "|"
 */
function serializeValueKey(value: unknown): string {
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
 * Scale lookup uses pre-resolved values shipped from the extraction pipeline.
 */
function resolveValue(
  value: unknown,
  dc: {
    varName: string;
    transform?: (value: string | number) => string | number;
    scaleValues?: Record<string, string>;
  }
): string {
  // 1. Scale resolution: check pre-resolved scale values
  const key = String(value);
  const scaleResolved = dc.scaleValues?.[key];
  if (scaleResolved != null) {
    // Scale match — apply transform to the resolved value, then return
    const transformed = dc.transform
      ? dc.transform(scaleResolved)
      : scaleResolved;
    return String(transformed);
  }

  // 2. No scale match — apply transform to raw value
  const transformed = dc.transform
    ? dc.transform(value as string | number)
    : value;

  // 3. Unit fallback
  return applyUnitFallback(transformed as string | number, dc.varName);
}

/**
 * Create a lightweight component that applies extracted CSS class names.
 * Replaces Emotion's styled() for extracted components.
 *
 * The element parameter accepts either an HTML tag string (e.g. 'button') or
 * a React component reference (e.g. NextLink). When a component reference is
 * used, prop forwarding skips the HTML-attribute validity check — all
 * non-filtered props are forwarded to the component.
 *
 * The optional systemPropMap parameter provides the shared prop→value→className
 * lookup table, served as a virtual module by the Vite plugin.
 *
 * The optional dynamicPropConfig parameter provides CSS variable fallback
 * metadata for props with detected dynamic usage.
 */
export function createComponent(
  element: ElementType,
  className: string,
  config: ComponentConfig,
  systemPropMap?: SystemPropMap,
  dynamicPropConfig?: DynamicPropConfig
): AnimusComponent {
  const variantProps = config.variants ? Object.keys(config.variants) : [];
  const stateProps = config.states || [];
  const systemPropNames = config.systemPropNames || [];
  const filterProps = new Set([
    ...variantProps,
    ...stateProps,
    ...systemPropNames,
  ]);

  // When element is not a string, it is a React component. Component elements
  // accept arbitrary props, so we skip the HTML attribute validity check and
  // forward everything that isn't an Animus-managed prop.
  const isComponentElement = typeof element !== 'string';

  const Component = forwardRef(
    (props: Record<string, any>, ref: ForwardedRef<any>) => {
      const classes = [className];

      // useRef-based memoization for dynamic style object
      const prevDynKey = useRef('');
      const prevDynStyle = useRef<Record<string, string> | null>(null);

      // Apply variant classes
      if (config.variants) {
        for (const [prop, vc] of Object.entries(config.variants)) {
          const value = props[prop] ?? vc.default;
          if (value != null) {
            classes.push(`${className}--${prop}-${value}`);
          }
        }
      }

      // Apply state classes
      if (config.states) {
        for (const state of config.states) {
          if (props[state]) {
            classes.push(`${className}--${state}`);
          }
        }
      }

      // Track dynamic CSS variable assignments
      let dynKeyParts: string[] | undefined;
      let dynStyle: Record<string, string> | undefined;

      // Apply system prop utility classes from shared map
      if (systemPropNames.length > 0) {
        const { customPropMap, customDynamicConfig } = config;

        for (const propName of systemPropNames) {
          if (!(propName in props)) continue;
          const propValue = props[propName];

          // Null/undefined: skip entirely — no class, no variable
          if (propValue == null) continue;

          const key = serializeValueKey(propValue);

          // Resolution order: customPropMap → systemPropMap → customDynamicConfig → dynamicPropConfig
          const cls =
            customPropMap?.[propName]?.[key] ??
            systemPropMap?.[propName]?.[key];

          if (cls) {
            // Static match — use extracted utility class
            classes.push(cls);
          } else {
            // Dynamic fallback — check per-component custom config first, then shared
            const dc =
              customDynamicConfig?.[propName] ?? dynamicPropConfig?.[propName];

            if (dc) {
              classes.push(dc.slotClass);

              if (!dynKeyParts) dynKeyParts = [];
              if (!dynStyle) dynStyle = {};

              if (
                typeof propValue === 'object' &&
                propValue !== null &&
                !Array.isArray(propValue)
              ) {
                // Responsive object: set per-breakpoint CSS variables
                for (const [bp, bpVal] of Object.entries(propValue)) {
                  if (bpVal == null) continue;
                  const varName =
                    bp === '_' ? dc.varName : `${dc.varName}-${bp}`;
                  const finalVal = resolveValue(bpVal, dc);
                  dynStyle[varName] = finalVal;
                  dynKeyParts.push(`${varName}:${finalVal}`);
                }
              } else {
                // Primitive value: set base CSS variable
                const finalVal = resolveValue(propValue, dc);
                dynStyle[dc.varName] = finalVal;
                dynKeyParts.push(`${dc.varName}:${finalVal}`);
              }
            }
          }
        }
      }

      // Merge external className
      if (props.className) {
        classes.push(props.className);
      }

      // Forward props to the underlying element, filtering out all Animus-managed
      // props. For HTML tag elements, also skip props that are not valid HTML
      // attributes to avoid React DOM warnings. For component elements, forward
      // all non-filtered props without an attribute validity check.
      const domProps: Record<string, any> = {
        ref,
        className: classes.join(' '),
      };
      for (const [key, value] of Object.entries(props)) {
        if (key === 'className') continue;
        if (filterProps.has(key)) continue;
        if (!isComponentElement) {
          // filterProps covers all Animus props — unknown props pass through,
          // letting React handle any unknown-attribute warnings in dev mode.
        }
        domProps[key] = value;
      }

      // Apply memoized dynamic style if any CSS variables were set
      if (dynKeyParts && dynStyle) {
        const dynKey = dynKeyParts.join('|');
        if (dynKey !== prevDynKey.current) {
          prevDynKey.current = dynKey;
          prevDynStyle.current = dynStyle;
        }
        domProps.style = props.style
          ? { ...props.style, ...prevDynStyle.current }
          : prevDynStyle.current;
      }

      return createElement(element as any, domProps);
    }
  );

  Component.displayName = className;

  return Object.assign(Component, {
    extend: (): never => {
      throw new Error(
        `Cannot extend extracted component "${className}" at runtime. ` +
          `Extensions must be authored in source code using the builder API ` +
          `(e.g. import the original component and call .extend() there) ` +
          `so the extraction pipeline can resolve them at build time.`
      );
    },
  }) as any;
}
