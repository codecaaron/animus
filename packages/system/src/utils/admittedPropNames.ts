import type { SystemProp } from '../types/config';

/**
 * The props a component's runtime filter keeps off the element, as the
 * extractor lists them: the props of each group it admitted, each prop it
 * admitted by name, and its custom props. A prop of a group it never admitted,
 * such as `size` on an input without the layout group, reaches the element.
 */
export function admittedPropNames(
  propRegistry: Record<string, SystemProp>,
  groupRegistry: Record<string, readonly PropertyKey[]>,
  activeGroups: Record<string, true>,
  custom: Record<string, SystemProp>
): string[] {
  const names = new Set<string>();
  for (const key of Object.keys(activeGroups)) {
    if (Object.hasOwn(groupRegistry, key)) {
      for (const prop of groupRegistry[key]) names.add(String(prop));
    } else if (Object.hasOwn(propRegistry, key)) {
      names.add(key);
    }
  }
  for (const key of Object.keys(custom)) names.add(key);
  return [...names];
}
