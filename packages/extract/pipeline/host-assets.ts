import { createRequire } from 'node:module';

import {
  BUILT_IN_ASSET_SOURCE,
  BUILT_IN_ASSET_TYPES,
} from './built-in-asset-types';

/** Which files a host serves as assets (spec §2.2 A8): an asset the host
 *  opens is an opaque value with no exports or effects, Resolved(asset). */
export interface HostAssetClassification {
  isAsset(path: string): boolean;
  /** Where the classification comes from: the host's captured option, or
   *  `built-in` with the reason (`noHost`, `hostOptionUnreadable`). */
  readonly resolverVersion: string;
}

const BUILT_IN_ASSET_RE = new RegExp(
  `\\.(?:${BUILT_IN_ASSET_TYPES.join('|')})(?:\\?.*)?$`,
  'i'
);

/** The built-in classification, where no host's can be read: Vite's known
 *  asset types (`BUILT_IN_ASSET_SOURCE`), less `svg`. */
export function builtInAssetClassification(
  reason: 'noHost' | 'hostOptionUnreadable',
  detail?: string
): HostAssetClassification {
  return {
    isAsset: (path) => BUILT_IN_ASSET_RE.test(path),
    resolverVersion: `built-in (${reason}${detail ? `: ${detail}` : ''}; ${BUILT_IN_ASSET_SOURCE})`,
  };
}

/** Vite's own classification: its known asset types and the user's
 *  `assetsInclude`, as `ResolvedConfig.assetsInclude` answers. */
export function viteAssetClassification(
  assetsInclude: (file: string) => boolean,
  version?: string
): HostAssetClassification {
  return {
    isAsset: (path) => assetsInclude(path),
    resolverVersion: `${version ? `vite@${version}` : 'vite'} captured`,
  };
}

/** One condition of a webpack or Rspack rule (`test`): a pattern, a path
 *  prefix, a predicate, a list (any), or a logical condition. */
export type RuleCondition =
  | RegExp
  | string
  | ((path: string) => boolean)
  | readonly RuleCondition[]
  | {
      readonly and?: readonly RuleCondition[];
      readonly or?: readonly RuleCondition[];
      readonly not?: RuleCondition;
    };

/** An entry of a rule list: a rule, or a falsy or `...` placeholder. */
export type RuleEntry = WebpackRule | '...' | '' | 0 | false | null | undefined;

/** One webpack or Rspack rule, as far as this reader reads it. */
export interface WebpackRule {
  readonly test?: RuleCondition;
  readonly type?: string;
  readonly loader?: string;
  readonly oneOf?: readonly RuleEntry[];
  readonly rules?: readonly RuleEntry[];
}

function isConditionList(
  condition: RuleCondition
): condition is readonly RuleCondition[] {
  return Array.isArray(condition);
}

function matches(condition: RuleCondition, path: string): boolean {
  if (isConditionList(condition)) {
    return condition.some((each) => matches(each, path));
  }
  if (condition instanceof RegExp) return condition.test(path);
  if (condition instanceof Function) return condition(path);
  if (condition instanceof Object) {
    const { and, or, not } = condition;
    return (
      (and === undefined || and.every((each) => matches(each, path))) &&
      (or === undefined || or.some((each) => matches(each, path))) &&
      (not === undefined || !matches(not, path))
    );
  }
  return path.startsWith(condition);
}

/** The `test` of each rule that serves its files as assets: an `asset*`
 *  module type, or Next's image loader. */
function assetTests(rules: readonly RuleEntry[] | undefined): RuleCondition[] {
  const tests: RuleCondition[] = [];
  for (const rule of rules ?? []) {
    if (!rule || rule === '...') continue;
    const asset =
      rule.type?.startsWith('asset') === true ||
      rule.loader === 'next-image-loader';
    if (asset && rule.test !== undefined) tests.push(rule.test);
    tests.push(...assetTests(rule.oneOf), ...assetTests(rule.rules));
  }
  return tests;
}

/** webpack's or Rspack's classification, from its module rules. */
export function webpackAssetClassification(
  host: 'webpack' | 'next-webpack' | 'rspack',
  rules: readonly RuleEntry[] | undefined,
  version?: string
): HostAssetClassification {
  const tests = assetTests(rules);
  return {
    isAsset: (path) => tests.some((test) => matches(test, path)),
    resolverVersion: `${version ? `${host}@${version}` : host} captured`,
  };
}

/** esbuild's classification, from its `loader` map: an extension loaded as
 *  a file, data URL, binary, base64 or text is an asset. */
export function esbuildAssetClassification(
  loader: Readonly<Record<string, string>> | undefined
): HostAssetClassification {
  const assets = new Set(
    Object.entries(loader ?? {})
      .filter(([, kind]) =>
        ['file', 'dataurl', 'binary', 'base64', 'text', 'copy'].includes(kind)
      )
      .map(([extension]) => extension.toLowerCase())
  );
  return {
    isAsset: (path) => {
      const dot = path.lastIndexOf('.');
      return dot !== -1 && assets.has(path.slice(dot).toLowerCase());
    },
    resolverVersion: 'esbuild captured',
  };
}

/** Turbopack's classification under Next: Next's static-image table, as
 *  the installed `next` declares it (`nextImageLoaderRegex`), unless
 *  `images.disableStaticImages`. Built-in where Next cannot be read. */
export function nextImageAssetClassification(
  rootDir: string,
  disableStaticImages: boolean
): HostAssetClassification {
  try {
    const require = createRequire(`${rootDir}/package.json`);
    const { version } = require('next/package.json');
    const { nextImageLoaderRegex } = require('next/dist/build/webpack-config');
    if (!(nextImageLoaderRegex instanceof RegExp)) {
      return builtInAssetClassification(
        'hostOptionUnreadable',
        `next@${version} image types`
      );
    }
    return {
      isAsset: (path) =>
        !disableStaticImages && nextImageLoaderRegex.test(path),
      resolverVersion: `from next@${version}`,
    };
  } catch {
    return builtInAssetClassification('hostOptionUnreadable', 'next');
  }
}
