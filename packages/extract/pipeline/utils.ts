export function camelToKebab(str: string): string {
  return str.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

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

/** Decided by an intrinsic only functions accept, so a spoofed
 *  `Symbol.toStringTag` cannot pass a plain object off as a function. */
function isCallable<Value>(value: Value): boolean {
  try {
    Function.prototype.toString.call(value);
    return true;
  } catch {
    return false;
  }
}

function isKeyedReference<Value>(value: Value): value is Value & object {
  return Object(value) === value && !isCallable(value);
}
