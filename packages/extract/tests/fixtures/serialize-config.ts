/**
 * Serializes the real @animus-ui/system prop config into the JSON the Rust
 * pipeline reads, so a group change needs no hand-maintained copy.
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

const TRANSFORM_MAP = new Map<Function, string>([
  [size, 'size'],
  [borderShorthand, 'borderShorthand'],
  [gridItemRatio, 'gridItemRatio'],
  [gridItem, 'gridItem'],
]);

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
 * `String(scale) === scale` holds only for a primitive name, so inline and
 * absent scales — which the Rust config never carries — are dropped.
 */
function isThemeScaleName(scale: Prop['scale']): scale is string {
  return String(scale) === scale;
}

/**
 * Every prop group flattened; the spread order must match the `addGroup`
 * calls in the canonical system config.
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
 * Group names must match the `addGroup()` calls exactly (`borders` is the
 * registered name for the `border` group).
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
