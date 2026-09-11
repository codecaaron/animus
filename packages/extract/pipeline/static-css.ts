/** The `staticCss` option declares emission the JSX scanner cannot observe
 *  (config-driven variants, spread props); the engine applies it as usage. */

import { stableStringify } from './utils';

export interface StaticCssComponentOverride {
  /** `'*'` = every option of every declared variant prop; per-prop `'*'` or
   *  an explicit option list otherwise. */
  variants?: '*' | Record<string, '*' | string[]>;
  /** `'*'` = every declared state; or an explicit list. */
  states?: '*' | string[];
  dynamicProps?: string[];
}

export interface StaticCssConfig {
  components?: Record<string, StaticCssComponentOverride>;
  systemProps?: Record<
    string,
    Array<string | number | Record<string, string | number>>
  >;
}

export function serializeStaticCss(
  config: StaticCssConfig | undefined
): string | null {
  if (!config) return null;
  const json = stableStringify(config);
  return json === '{}' ? null : json;
}
