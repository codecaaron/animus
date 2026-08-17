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
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}
