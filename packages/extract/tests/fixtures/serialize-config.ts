/**
 * Programmatically serialize the prop config from @animus-ui/system.
 *
 * This imports the REAL config — the source of truth — and serializes it
 * to the JSON format expected by the Rust extraction pipeline. Transform
 * functions are mapped to string identifiers that Rust dispatches natively.
 *
 * If system's groups change, this serialization changes with it. No hand-maintenance.
 */

import {
  borderShorthand,
  gridItem,
  gridItemRatio,
  size,
} from '@animus-ui/system';
import {
  background,
  border,
  color,
  flex,
  grid,
  layout,
  positioning,
  shadows,
  space,
  transitions,
  typography,
} from '@animus-ui/system/groups';

import type { Prop } from '@animus-ui/system';

/** Known transform functions → Rust string identifiers */
const TRANSFORM_MAP = new Map<Function, string>([
  [size, 'size'],
  [borderShorthand, 'borderShorthand'],
  [gridItemRatio, 'gridItemRatio'],
  [gridItem, 'gridItem'],
]);

/** Prop name → the system's OWN prop contract: the registry
 *  `createSystem().addGroup()` accumulates. */
interface PropRegistry {
  readonly [propName: string]: Prop;
}

interface SerializedEntry {
  property: string;
  properties?: readonly string[];
  scale?: string;
  transform?: string;
}

/**
 * A theme scale reference is the scale's NAME. Strict identity under `String`
 * holds only for a primitive string — an inline `createScale()` scale, like an
 * absent one, can never equal its own `String()` rendering — so this admits
 * exactly the scale names the Rust config reads and drops the rest (inline
 * scales are type-only constraints the config never carries).
 */
function isThemeScaleName(scale: Prop['scale']): scale is string {
  return String(scale) === scale;
}

/**
 * All prop groups flattened — matches what createSystem().addGroup() accumulates.
 * Order matches the addGroup calls in the canonical system config.
 */
const allProps: PropRegistry = {
  ...flex,
  ...grid,
  ...space,
  ...color,
  ...layout,
  ...border,
  ...shadows,
  ...background,
  ...typography,
  ...positioning,
  ...transitions,
};

function serializeProps() {
  const result: Record<string, SerializedEntry> = {};

  for (const [propName, entry] of Object.entries(allProps)) {
    const serialized: SerializedEntry = {
      property: entry.property,
    };

    if (entry.properties && entry.properties.length > 0) {
      serialized.properties = entry.properties;
    }

    // Only theme scale names (theme lookups) reach the Rust config.
    if (isThemeScaleName(entry.scale)) {
      serialized.scale = entry.scale;
    }

    if (entry.transform) {
      const name = TRANSFORM_MAP.get(entry.transform);
      if (name) {
        serialized.transform = name;
      }
    }

    result[propName] = serialized;
  }

  return result;
}

export const serializedConfig = JSON.stringify(serializeProps());

/**
 * Group registry — maps group name to array of prop names.
 * This mirrors what createSystem().addGroup(name, props) builds.
 * Group names must match the addGroup() calls exactly.
 */
function buildGroupRegistry() {
  return {
    flex: Object.keys(flex),
    grid: Object.keys(grid),
    space: Object.keys(space),
    color: Object.keys(color),
    layout: Object.keys(layout),
    borders: Object.keys(border),
    shadows: Object.keys(shadows),
    background: Object.keys(background),
    typography: Object.keys(typography),
    positioning: Object.keys(positioning),
    transitions: Object.keys(transitions),
  };
}

export const serializedGroupRegistry = JSON.stringify(buildGroupRegistry());
