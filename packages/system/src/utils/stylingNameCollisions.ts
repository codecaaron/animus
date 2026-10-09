import type { SystemProp, VariantConfig } from '../types/config';

/**
 * A variant or state named after an admitted system prop would be driven by
 * the same value as that prop, so the builder rejects the pair. Extracted
 * chains never run the builder, so extraction needs a check of its own.
 */
export function assertDisjointStylingNames(
  variants: Record<string, VariantConfig>,
  states: readonly string[],
  groupRegistry: Record<string, readonly PropertyKey[]>,
  propRegistry: Record<string, SystemProp>,
  activeGroups: Record<string, true>
): void {
  const admittedBy = new Map<string, string>();
  for (const key of Object.keys(activeGroups)) {
    if (Object.hasOwn(groupRegistry, key)) {
      for (const prop of groupRegistry[key]) {
        admittedBy.set(String(prop), `group "${key}"`);
      }
    } else if (Object.hasOwn(propRegistry, key)) {
      admittedBy.set(key, `.system({ ${key}: true })`);
    }
  }
  const variantProps = Object.entries(variants).map(
    ([key, config]) => config.prop || key
  );
  const declared: [kind: string, names: readonly string[]][] = [
    ['Variant prop', variantProps],
    ['State', states],
  ];
  for (const [kind, names] of declared) {
    for (const name of names) {
      const source = admittedBy.get(name);
      if (source === undefined) continue;
      throw new Error(
        `${kind} "${name}" collides with the system prop "${name}" admitted ` +
          `by ${source}. A variant or state and an admitted system prop ` +
          `need different names.`
      );
    }
  }
}
