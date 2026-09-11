/**
 * The JSON value domain for verification code that reads an artifact back.
 * Test-only: shipped packages name their own domain type at each ingress.
 */

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | JsonObject;

export interface JsonObject {
  [key: string]: JsonValue;
}

/**
 * A keyed JSON object, decided by representation tag rather than `typeof`,
 * which separates it from a list and from what `JSON.parse` cannot produce.
 */
export function isJsonObject(value: JsonValue): value is JsonObject {
  return Object.prototype.toString.call(value) === '[object Object]';
}

export function isJsonString(value: JsonValue): value is string {
  return Object.prototype.toString.call(value) === '[object String]';
}

export function isJsonNumber(value: JsonValue): value is number {
  return Object.prototype.toString.call(value) === '[object Number]';
}

export function isJsonBoolean(value: JsonValue): value is boolean {
  return Object.prototype.toString.call(value) === '[object Boolean]';
}

export function parseJsonObject(bytes: string, boundary: string): JsonObject {
  const candidate: JsonValue = JSON.parse(bytes);
  if (!isJsonObject(candidate)) {
    throw new TypeError(`${boundary} must contain a JSON object`);
  }
  return candidate;
}
