export function isObject(value: unknown): value is object {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

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
 * A `_` key is an identity marker: it takes the parent path with no suffix.
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

export function dotToDash(dotPath: string): string {
  return dotPath.replace(/\./g, '-');
}
