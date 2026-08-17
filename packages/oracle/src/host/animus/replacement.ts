import { AnimusAdapterError } from './errors';
import { isManifestJsonObject, isManifestJsonString } from './manifest-types';

import type {
  AnimusManifest,
  ManifestComponent,
  ManifestJsonValue,
} from './manifest-types';

/**
 * The per-component authority on variants, compounds and states.
 *
 * `manifest.crossFile.variantOptions` / `stateNames` look like the same data
 * and are not: they are keyed by *bare binding*, so two components named
 * `Button` in different files collide into one entry. The emitted
 * `replacement` string carries the config the runtime actually resolves
 * against, per component id — so that is what is read here, and the crossFile
 * maps stay auxiliary.
 */
export interface VariantConfig {
  options: readonly string[];
  default?: string;
}

export interface CompoundConfig {
  conditions: Readonly<Record<string, string | readonly string[]>>;
  className: string;
}

export interface ReplacementConfig {
  variants?: Readonly<Record<string, VariantConfig>>;
  compounds?: readonly CompoundConfig[];
  states?: readonly string[];
  systemPropNames?: readonly string[];
}

export interface ParsedComponent {
  id: string;
  record: ManifestComponent;
  config: ReplacementConfig;
  /** Set when the config had to be recovered key-by-key; see `parseConfig`. */
  note?: string;
}

export interface ParsedReplacementConfig {
  config: ReplacementConfig;
  note?: string;
}

const parseReplacementJson = (text: string): ManifestJsonValue =>
  JSON.parse(text);

const FACTORY = /\b(createComponent|createClassResolver)\s*\(/;

/** Scan a balanced `{…}` / `[…]` from `start`, respecting quotes. */
const readBalanced = (text: string, start: number): string | undefined => {
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let quote: string | null = null;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (quote !== null) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return undefined;
};

/** The first argument that is an object literal — the resolver config. */
const configText = (replacement: string, id: string): string => {
  const factory = FACTORY.exec(replacement);
  if (factory === null) {
    throw new AnimusAdapterError(
      'component replacement does not call createComponent or ' +
        'createClassResolver',
      { construct: 'replacement', layer: id, snippet: replacement }
    );
  }

  let index = factory.index + factory[0].length;
  let depth = 0;
  let quote: string | null = null;

  for (; index < replacement.length; index += 1) {
    const char = replacement[index];
    if (quote !== null) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') {
      if (depth === 0) break;
      depth -= 1;
    } else if (char === '{' && depth === 0) {
      const block = readBalanced(replacement, index);
      if (block === undefined) break;
      return block;
    }
  }

  throw new AnimusAdapterError(
    'component replacement has no config object literal',
    { construct: 'replacement', layer: id, snippet: replacement }
  );
};

const jsonAt = (
  text: string,
  key: string,
  id: string
): ManifestJsonValue | undefined => {
  const marker = `"${key}"`;
  const at = text.indexOf(marker);
  if (at === -1) return undefined;

  let cursor = at + marker.length;
  while (cursor < text.length && /[\s:]/.test(text[cursor])) cursor += 1;
  const char = text[cursor];
  if (char !== '{' && char !== '[') return undefined;

  const block = readBalanced(text, cursor);
  if (block === undefined) return undefined;
  try {
    return parseReplacementJson(block);
  } catch {
    throw new AnimusAdapterError(
      `component config key \`${key}\` is not valid JSON`,
      { construct: `replacement.${key}`, layer: id, snippet: block }
    );
  }
};

const asVariants = (
  value: ManifestJsonValue | undefined
): Readonly<Record<string, VariantConfig>> | undefined => {
  if (!isManifestJsonObject(value)) return undefined;
  const variants: Record<string, VariantConfig> = {};
  for (const [prop, config] of Object.entries(value)) {
    if (!isManifestJsonObject(config) || !Array.isArray(config.options)) {
      continue;
    }
    const options = config.options.filter(isManifestJsonString);
    const variant: VariantConfig = { options };
    if (isManifestJsonString(config.default)) {
      variant.default = config.default;
    }
    variants[prop] = variant;
  }
  return variants;
};

const asCompounds = (
  value: ManifestJsonValue | undefined
): CompoundConfig[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const compounds: CompoundConfig[] = [];
  for (const entry of value) {
    if (!isManifestJsonObject(entry)) continue;
    if (
      !isManifestJsonString(entry.className) ||
      !isManifestJsonObject(entry.conditions)
    ) {
      continue;
    }
    const conditions: Record<string, string | string[]> = {};
    for (const [prop, expected] of Object.entries(entry.conditions)) {
      if (isManifestJsonString(expected)) conditions[prop] = expected;
      else if (Array.isArray(expected)) {
        conditions[prop] = expected.filter(isManifestJsonString);
      }
    }
    compounds.push({ conditions, className: entry.className });
  }
  return compounds;
};

const asStrings = (
  value: ManifestJsonValue | undefined
): string[] | undefined =>
  Array.isArray(value) ? value.filter(isManifestJsonString) : undefined;

/**
 * Parse the config object out of a replacement string.
 *
 * The fast path is `JSON.parse` over the whole literal, which is what the
 * emitter produces for every statically known config. It is not universal:
 * a component whose system props come from group spreads emits
 * `{"systemPropNames":[].concat(systemPropGroups.layout,…)}` — valid JS,
 * invalid JSON. Rather than lose the *whole* config to one dynamic value, the
 * fallback recovers the JSON-valued keys individually and takes
 * `systemPropNames` from the manifest's own resolved `system_prop_names`
 * field. A key that is present but malformed still throws — the fallback
 * narrows what is unreadable, it never invents what it could not read.
 */
export const parseConfig = (
  id: string,
  record: ManifestComponent
): ParsedReplacementConfig => {
  const text = configText(record.replacement, id);
  const systemPropNames = asStrings(record.system_prop_names) ?? [];

  let parsed: ManifestJsonValue | undefined;
  try {
    parsed = parseReplacementJson(text);
  } catch {
    parsed = undefined;
  }

  if (isManifestJsonObject(parsed)) {
    const variants = asVariants(parsed.variants);
    const compounds = asCompounds(parsed.compounds);
    const states = asStrings(parsed.states);
    const config: ReplacementConfig = {};
    if (variants !== undefined) config.variants = variants;
    if (compounds !== undefined) config.compounds = compounds;
    if (states !== undefined) config.states = states;
    config.systemPropNames =
      asStrings(parsed.systemPropNames) ?? systemPropNames;
    return { config };
  }

  const variants = asVariants(jsonAt(text, 'variants', id));
  const compounds = asCompounds(jsonAt(text, 'compounds', id));
  const states = asStrings(jsonAt(text, 'states', id));

  const config: ReplacementConfig = {};
  if (variants !== undefined) config.variants = variants;
  if (compounds !== undefined) config.compounds = compounds;
  if (states !== undefined) config.states = states;
  config.systemPropNames = systemPropNames;

  return {
    config,
    note:
      'replacement config is not strict JSON (a dynamic expression is ' +
      'present); variants/compounds/states were recovered structurally and ' +
      'systemPropNames came from the manifest component record',
  };
};

/** Every component in the manifest, with its config, in manifest key order. */
export const parseComponents = (
  manifest: AnimusManifest
): ParsedComponent[] => {
  const components: ParsedComponent[] = [];

  for (const [id, record] of Object.entries(manifest.components)) {
    const { config, note } = parseConfig(id, record);
    const component: ParsedComponent = { id, record, config };
    if (note !== undefined) component.note = note;
    components.push(component);
  }

  return components;
};
