/**
 * Programmatically serialize the prop config from @animus-ui/core.
 *
 * This imports the REAL config — the source of truth — and serializes it
 * to the JSON format expected by the Rust extraction pipeline. Transform
 * functions are mapped to string identifiers that Rust dispatches natively.
 *
 * If config.ts changes, this serialization changes with it. No hand-maintenance.
 */
import {
  color,
  border,
  flex,
  grid,
  background,
  positioning,
  shadows,
  layout,
  typography,
  space,
  transitions,
} from '../../../../packages/core/src/config';

import {
  size,
  borderShorthand,
  gridItemRatio,
  gridItem,
} from '../../../../packages/core/src/transforms';

/** Known transform functions → Rust string identifiers */
const TRANSFORM_MAP = new Map<Function, string>([
  [size, 'size'],
  [borderShorthand, 'borderShorthand'],
  [gridItemRatio, 'gridItemRatio'],
  [gridItem, 'gridItem'],
]);

interface PropEntry {
  property: string;
  properties?: string[];
  scale?: string | Record<string, any> | any[];
  transform?: Function;
}

interface SerializedEntry {
  property: string;
  properties?: string[];
  scale?: string;
  transform?: string;
}

/**
 * All prop groups flattened — matches what createAnimus().addGroup() accumulates.
 * This is the same set of props that `config.build()` produces as `propRegistry`.
 * Order matches the addGroup calls in config.ts.
 */
const allProps: Record<string, PropEntry> = {
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

function serializeProps(): Record<string, SerializedEntry> {
  const result: Record<string, SerializedEntry> = {};

  for (const [propName, entry] of Object.entries(allProps)) {
    const serialized: SerializedEntry = {
      property: entry.property,
    };

    if (entry.properties && entry.properties.length > 0) {
      serialized.properties = entry.properties;
    }

    // Only string scale names (theme lookups).
    // Inline scales (createScale() objects/arrays) are type-only constraints.
    if (typeof entry.scale === 'string') {
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
