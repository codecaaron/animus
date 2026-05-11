/** Type guard: true for non-null, non-array objects */
export function isObject(value: unknown): value is object {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Deep merge — matches lodash.merge overload signatures */
export function merge<A, B>(target: A, source: B): A & B;
export function merge<A, B, C>(target: A, s1: B, s2: C): A & B & C;
export function merge<A, B, C, D>(
  target: A,
  s1: B,
  s2: C,
  s3: D
): A & B & C & D;
export function merge(target: any, ...sources: any[]): any {
  for (const source of sources) {
    if (!source) continue;
    for (const key of Object.keys(source)) {
      const targetVal = target[key];
      const sourceVal = source[key];
      if (isObject(targetVal) && isObject(sourceVal)) {
        target[key] = merge(targetVal, sourceVal);
      } else {
        target[key] = sourceVal;
      }
    }
  }
  return target;
}

/**
 * Resolve a dot-path string against a nested object.
 * walkDotPath({ gray: { 50: '#fafafa' } }, 'gray.50') → '#fafafa'
 * The `_` identity key is handled: 'primary' resolves to obj.primary._ if obj.primary is an object with _.
 */
export function walkDotPath(
  obj: Record<string, unknown>,
  path: string
): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (!isObject(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Flatten a nested object into a flat Record with dot-path keys.
 * The `_` key is an identity marker — it produces the parent key without suffix.
 * { gray: { 50: '#fafafa' } } → { 'gray.50': '#fafafa' }
 * { primary: { _: 'ember', hover: 'x' } } → { 'primary': 'ember', 'primary.hover': 'x' }
 * CSS variable names use dash-join, computed at the serialization boundary (not here).
 */
export function flattenToDotPaths(
  object: Record<string | number, unknown>,
  path?: string
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(object)) {
    const nextKey = path ? (key === '_' ? path : `${path}.${key}`) : key;
    const current = object[key];
    if (isObject(current)) {
      Object.assign(
        result,
        flattenToDotPaths(current as Record<string | number, unknown>, nextKey)
      );
    } else {
      result[nextKey] = current;
    }
  }
  return result;
}

/**
 * Convert a dot-path key to a dash-join key for CSS variable naming.
 * 'gray.50' → 'gray-50'
 * 'primary.hover' → 'primary-hover'
 */
export function dotToDash(dotPath: string): string {
  return dotPath.replace(/\./g, '-');
}

/** Map over object values — matches lodash.mapValues overload signatures */
