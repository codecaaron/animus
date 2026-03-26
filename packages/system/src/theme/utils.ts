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

/** Map over object values — matches lodash.mapValues overload signatures */
export function mapValues<T extends object, TResult>(
  obj: T,
  fn: (value: T[keyof T], key: string, collection: T) => TResult
): { [P in keyof T]: TResult };
export function mapValues<TResult>(
  obj: Record<string, any>,
  fn: (value: any, key: string) => TResult
): Record<string, TResult>;
export function mapValues(
  obj: any,
  fn: (value: any, key: string, collection: any) => any
): any {
  const result: Record<string, any> = {};
  for (const key of Object.keys(obj)) {
    result[key] = fn(obj[key], key, obj);
  }
  return result;
}
