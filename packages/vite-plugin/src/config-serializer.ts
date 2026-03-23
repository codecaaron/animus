/**
 * Serialize the prop config from @animus-ui/core for the Rust extraction pipeline.
 *
 * Maps JS transform functions to string identifiers that the Rust crate
 * can dispatch to its native implementations.
 */

import { borderShorthand, gridItemRatio, size } from '@animus-ui/core';

/** Known transforms and their string identifiers. */
const TRANSFORM_MAP = new Map<Function, string>([
  [size, 'size'],
  [borderShorthand, 'borderShorthand'],
  [gridItemRatio, 'gridItemRatio'],
]);

interface PropConfig {
  property: string;
  properties?: string[];
  scale?: string | Record<string, any> | any[];
  transform?: Function;
}

interface SerializedPropConfig {
  property: string;
  properties?: string[];
  scale?: string;
  transform?: string;
}

/**
 * Serialize all prop groups from the animus config into a JSON map.
 * Prop config entries with inline scales (object/array) are skipped
 * since the Rust crate only handles named theme scales.
 */
export function serializeConfig(
  propRegistry: Record<string, PropConfig>
): string {
  const serialized: Record<string, SerializedPropConfig> = {};

  for (const [propName, config] of Object.entries(propRegistry)) {
    const entry: SerializedPropConfig = {
      property: config.property,
    };

    if (config.properties && config.properties.length > 0) {
      entry.properties = config.properties;
    }

    // Only include string scale names (theme lookups).
    // Inline scales (objects/arrays) are used for type constraints, not runtime lookups.
    if (typeof config.scale === 'string') {
      entry.scale = config.scale;
    }

    // Map transform function to string identifier
    if (config.transform) {
      const transformName = TRANSFORM_MAP.get(config.transform);
      if (transformName) {
        entry.transform = transformName;
      }
    }

    serialized[propName] = entry;
  }

  return JSON.stringify(serialized);
}

/**
 * Serialize the group registry from the Animus config.
 * Maps each group name to its array of constituent prop names.
 */
export function serializeGroupRegistry(
  groupRegistry: Record<string, string[]>
): string {
  return JSON.stringify(groupRegistry);
}
