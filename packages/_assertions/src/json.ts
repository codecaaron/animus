/**
 * The JSON value domain, for verification code that reads an artifact back.
 *
 * Every consumer here decodes bytes it did not produce in-process — an
 * on-disk artifact, a NAPI/process boundary payload, a recorded mock argument.
 * The point of a shared vocabulary is that "what `JSON.parse` produces" is one
 * fact: a reader that reaches an unmodeled key gets a value it can decide
 * about (object, list, scalar, null) instead of one it can only dereference on
 * faith.
 *
 * Test/verification code only. Shipped packages name their own domain type at
 * each ingress (`ManifestJsonValue`, `AnalysisSourceJsonValue`, …) rather than
 * taking a dependency on assertion utilities.
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
 * A keyed JSON object, decided by representation tag rather than by `typeof`:
 * the `[object Object]` tag is what separates a keyed block from a list, and
 * everything `JSON.parse` cannot produce — callables, boxed primitives,
 * `Date`/`Map` and friends — is rejected here rather than downstream, which is
 * the whole point of admitting a foreign document at one boundary.
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

/**
 * Decode `bytes` at a named boundary. `boundary` names the artifact or seam
 * the bytes came from, so a malformed document says which one it was.
 */
export function parseJsonObject(bytes: string, boundary: string): JsonObject {
  const candidate: JsonValue = JSON.parse(bytes);
  if (!isJsonObject(candidate)) {
    throw new TypeError(`${boundary} must contain a JSON object`);
  }
  return candidate;
}
