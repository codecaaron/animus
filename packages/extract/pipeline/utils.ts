/** Convert camelCase CSS property names to kebab-case. */
export function camelToKebab(str: string): string {
  return str.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

/**
 * Key-sorted stringify so semantically identical configuration serializes
 * identically. The one canonical form behind every configuration identity a
 * driver derives — engine inputs (`serializeStaticCss`) and the browser
 * bridge's per-instance registry key alike — so two configurations that agree
 * can never hash apart, and two that differ can never hash together.
 * `undefined` members are dropped exactly as `JSON.stringify` drops them.
 */
export function stableStringify<Value>(value: Value): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (isKeyedReference(value)) {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * A callable, decided by the one intrinsic only functions accept. Immune to a
 * spoofed `Symbol.toStringTag` (the tag-based test would let a plain object
 * claim to be a function, and vice versa).
 */
function isCallable<Value>(value: Value): boolean {
  try {
    Function.prototype.toString.call(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * A value with own enumerable keys to sort — the population `stableStringify`
 * must canonicalize rather than hand to `JSON.stringify` whole.
 * `Object(value) === value` admits exactly the references (objects, arrays,
 * functions) and rejects every primitive including `null`; functions are then
 * excluded so they keep reaching `JSON.stringify`, which drops them, instead
 * of canonicalizing to an empty object.
 */
function isKeyedReference<Value>(value: Value): value is Value & object {
  return Object(value) === value && !isCallable(value);
}
