/**
 * Forced-emission declarations (spec: static-emission-overrides) — the
 * `staticCss` plugin option. Declares emission the JSX scanner may never
 * observe (CMS/config-driven variants, spread-hidden props, dynamically
 * selected components); the engine applies it as synthetic usage through
 * the ordinary ledger.
 */

import { stableStringify } from './utils';

export interface StaticCssComponentOverride {
  /** `'*'` = every option of every declared variant prop; or per-prop
   *  `'*'` / explicit option lists. */
  variants?: '*' | Record<string, '*' | string[]>;
  /** `'*'` = every declared state; or an explicit list. */
  states?: '*' | string[];
  /** Custom props whose dynamic slot must be emitted without detected
   *  dynamic usage. */
  dynamicProps?: string[];
}

export interface StaticCssConfig {
  components?: Record<string, StaticCssComponentOverride>;
  /** System prop → value list (strings, numbers, or responsive objects). */
  systemProps?: Record<
    string,
    Array<string | number | Record<string, string | number>>
  >;
}

/** Serialize a staticCss option for the engine; null when absent/empty. */
export function serializeStaticCss(
  config: StaticCssConfig | undefined
): string | null {
  if (!config) return null;
  const json = stableStringify(config);
  return json === '{}' ? null : json;
}
