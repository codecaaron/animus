import { createRequire } from 'node:module';

import {
  BUILT_IN_ASSET_SOURCE,
  BUILT_IN_ASSET_TYPES,
  BUILT_IN_STYLESHEET_TYPES,
} from './built-in-asset-types';

/** Which files a host loads as opaque values (spec §2.2 A8): an asset, or a
 *  stylesheet, with no JS exports or effects on app objects (a CSS module's
 *  class-name map is opaque data). An opaque file the host opens is
 *  Resolved(asset). Where the host's reading is uncertain, a file is not
 *  opaque. */
export interface HostAssetClassification {
  /** Whether the host loads `file`, requested with `query` (`''`, or the
   *  specifier's `?…`), as an opaque value. */
  isAsset(file: string, query: string): boolean;
  /** Where the classification comes from: the host's captured option, or
   *  `built-in` with the reason (`noHost`, `hostOptionUnreadable`). */
  readonly resolverVersion: string;
}

const BUILT_IN_ASSET_RE = new RegExp(
  `\\.(?:${BUILT_IN_ASSET_TYPES.join('|')})$`,
  'i'
);

/** Vite's stylesheet test (`isCSSRequest`), on the final extension only: a
 *  `x.css.ts` is a module. Exact case, as Vite reads it. */
const STYLESHEET_RE = new RegExp(
  `\\.(?:${BUILT_IN_STYLESHEET_TYPES.join('|')})$`
);

/** The queries Vite answers with a string whatever the file holds: `?url`
 *  and `?raw`. Any other query keeps the file's own reading. */
const VITE_OPAQUE_QUERY_RE = /[?&](?:url|raw)\b/;

/** The built-in classification, where no host's can be read: Vite's known
 *  asset types, less `svg`, and its CSS languages (`BUILT_IN_ASSET_SOURCE`),
 *  read with Vite's queries. */
export function builtInAssetClassification(
  reason: 'noHost' | 'hostOptionUnreadable',
  detail?: string
): HostAssetClassification {
  return {
    isAsset: (file, query) =>
      VITE_OPAQUE_QUERY_RE.test(query) ||
      BUILT_IN_ASSET_RE.test(file) ||
      STYLESHEET_RE.test(file),
    resolverVersion: `built-in (${reason}${detail ? `: ${detail}` : ''}; ${BUILT_IN_ASSET_SOURCE})`,
  };
}

/** Vite's own classification: `?url` and `?raw`, its known asset types and
 *  the user's `assetsInclude`, as `ResolvedConfig.assetsInclude` answers,
 *  and its CSS languages (`isCSSRequest`). */
export function viteAssetClassification(
  assetsInclude: (file: string) => boolean,
  version?: string
): HostAssetClassification {
  return {
    isAsset: (file, query) =>
      VITE_OPAQUE_QUERY_RE.test(query) ||
      assetsInclude(file) ||
      STYLESHEET_RE.test(file),
    resolverVersion: `${version ? `vite@${version}` : 'vite'} captured`,
  };
}

/** One condition of a webpack or Rspack rule: a pattern, a path prefix, a
 *  predicate, a list (any), or a logical condition. */
export type RuleCondition =
  | RegExp
  | string
  | ((value: string) => boolean)
  | readonly RuleCondition[]
  | {
      readonly and?: readonly RuleCondition[];
      readonly or?: readonly RuleCondition[];
      readonly not?: RuleCondition;
    };

/** An entry of a rule list: a rule, or a falsy or `...` placeholder. */
export type RuleEntry = WebpackRule | '...' | '' | 0 | false | null | undefined;

/** One loader of a rule's `use`: its request, an object naming it, a
 *  function that picks loaders per module, or a placeholder. */
type RuleLoader =
  | string
  | { readonly loader?: string }
  | ((data: never) => void)
  | 0
  | false
  | null
  | undefined;

/** One webpack or Rspack rule, as far as this reader reads it. A condition
 *  it does not read (`issuer`, `issuerLayer`, `dependency`, …) leaves the
 *  rule possibly matching. */
export interface WebpackRule {
  readonly test?: RuleCondition;
  readonly include?: RuleCondition;
  readonly exclude?: RuleCondition;
  readonly resource?: RuleCondition;
  readonly resourceQuery?: RuleCondition;
  readonly type?: string;
  readonly loader?: string;
  readonly use?: RuleLoader | readonly RuleLoader[];
  /** Conditions this reader does not read. */
  readonly issuer?: RuleCondition;
  readonly issuerLayer?: RuleCondition;
  readonly oneOf?: readonly RuleEntry[];
  readonly rules?: readonly RuleEntry[];
}

/** Whether a condition or rule matches: certainly, possibly, or not. */
type Match = 'yes' | 'maybe' | 'no';

const both = (a: Match, b: Match): Match =>
  a === 'no' || b === 'no'
    ? 'no'
    : a === 'maybe' || b === 'maybe'
      ? 'maybe'
      : 'yes';

const either = (a: Match, b: Match): Match =>
  a === 'yes' || b === 'yes'
    ? 'yes'
    : a === 'maybe' || b === 'maybe'
      ? 'maybe'
      : 'no';

const negated = (a: Match): Match =>
  a === 'yes' ? 'no' : a === 'no' ? 'yes' : 'maybe';

function isLoaderList(
  use: RuleLoader | readonly RuleLoader[]
): use is readonly RuleLoader[] {
  return Array.isArray(use);
}

function isConditionList(
  condition: RuleCondition
): condition is readonly RuleCondition[] {
  return Array.isArray(condition);
}

const LOGICAL_KEYS = new Set(['and', 'or', 'not']);

function matches(condition: RuleCondition, value: string): Match {
  if (isConditionList(condition)) {
    return condition.reduce<Match>(
      (match, each) => either(match, matches(each, value)),
      'no'
    );
  }
  if (condition instanceof RegExp) {
    return new RegExp(condition.source, condition.flags.replace('g', '')).test(
      value
    )
      ? 'yes'
      : 'no';
  }
  if (condition instanceof Function) {
    try {
      return condition(value) ? 'yes' : 'no';
    } catch {
      // A predicate that throws answers nothing.
      return 'maybe';
    }
  }
  if (condition instanceof Object) {
    if (Object.keys(condition).some((key) => !LOGICAL_KEYS.has(key))) {
      return 'maybe';
    }
    const { and, or, not } = condition;
    let match: Match = 'yes';
    if (and !== undefined) {
      match = and.reduce<Match>(
        (all, each) => both(all, matches(each, value)),
        match
      );
    }
    if (or !== undefined) {
      match = both(
        match,
        or.reduce<Match>((any, each) => either(any, matches(each, value)), 'no')
      );
    }
    if (not !== undefined) match = both(match, negated(matches(not, value)));
    return match;
  }
  return value.startsWith(condition) ? 'yes' : 'no';
}

/** The rule keys this reader reads: its path and query conditions, its
 *  effects, and its nested rules. Any other key may be a condition. */
const READ_KEYS = new Set([
  'test',
  'include',
  'exclude',
  'resource',
  'resourceQuery',
  'type',
  'loader',
  'options',
  'use',
  'oneOf',
  'rules',
  'enforce',
  'sideEffects',
  'parser',
  'generator',
  'resolve',
  'layer',
]);

function ruleMatches(rule: WebpackRule, file: string, query: string): Match {
  let match: Match = 'yes';
  for (const condition of [rule.test, rule.include, rule.resource]) {
    if (condition !== undefined) match = both(match, matches(condition, file));
  }
  if (rule.exclude !== undefined) {
    match = both(match, negated(matches(rule.exclude, file)));
  }
  if (rule.resourceQuery !== undefined) {
    match = both(match, matches(rule.resourceQuery, query));
  }
  return Object.keys(rule).some((key) => !READ_KEYS.has(key))
    ? both(match, 'maybe')
    : match;
}

/** A loader's package name, from its request: the path segment that names
 *  it (`…/css-loader/src`, `next/dist/compiled/ignore-loader`). */
function loaderNames(request: string): string[] {
  return (request.split('?')[0] ?? '')
    .split(/[\\/]/)
    .map((segment) => segment.replace(/\.c?js$/, ''));
}

/** Loaders whose module is a stylesheet's: its CSS, or its class-name map. */
const STYLESHEET_LOADERS = new Set([
  'css-loader',
  'lightningcss-loader',
  'next-flight-css-loader',
]);

/** What a rule makes of a file it applies to: an opaque value, a module, or
 *  nothing it reads (no type and no loader). */
function ruleEffect(rule: WebpackRule): 'opaque' | 'module' | 'none' {
  if (rule.type !== undefined) {
    return /^(?:asset|css)(?:\/|$)/.test(rule.type) ? 'opaque' : 'module';
  }
  const use = rule.use;
  const listed = use === undefined ? [] : isLoaderList(use) ? use : [use];
  const requests = rule.loader === undefined ? [] : [rule.loader];
  for (const each of listed) {
    if (!each) continue;
    // A function picks loaders per module: what it picks is unread.
    if (each instanceof Function) return 'module';
    requests.push(each instanceof Object ? (each.loader ?? '') : each);
  }
  if (requests.length === 0) return 'none';
  const named = requests.map(loaderNames);
  // A build that applies `error-loader` fails, so a build that runs never
  // applied it; `ignore-loader` makes an empty module.
  const live = named.filter((names) => !names.includes('error-loader'));
  if (live.length === 0) return 'none';
  if (live.every((names) => names.includes('ignore-loader'))) return 'opaque';
  if (live.length === 1 && live[0]?.includes('next-image-loader')) {
    return 'opaque';
  }
  return live.some((names) =>
    names.some((name) => STYLESHEET_LOADERS.has(name))
  )
    ? 'opaque'
    : 'module';
}

/** The effects of every rule that can apply to `file`: all of a list's
 *  matching rules, and of a `oneOf`, each entry up to the first that
 *  certainly matches. */
function effects(
  rules: readonly RuleEntry[] | undefined,
  file: string,
  query: string,
  into: Array<'opaque' | 'module'>
): void {
  for (const rule of rules ?? []) {
    if (!rule || rule === '...') continue;
    if (ruleMatches(rule, file, query) !== 'no') apply(rule, file, query, into);
  }
}

function apply(
  rule: WebpackRule,
  file: string,
  query: string,
  into: Array<'opaque' | 'module'>
): void {
  const effect = ruleEffect(rule);
  if (effect !== 'none') into.push(effect);
  effects(rule.rules, file, query, into);
  for (const entry of rule.oneOf ?? []) {
    if (!entry || entry === '...') continue;
    const match = ruleMatches(entry, file, query);
    if (match === 'no') continue;
    apply(entry, file, query, into);
    if (match === 'yes') break;
  }
}

/** webpack's or Rspack's classification, from its module rules: a file is
 *  opaque only where every rule that can apply to it makes it an asset or
 *  a stylesheet (`asset*` or `css*` type, Next's image loader, a CSS
 *  loader). A rule that may apply and makes a module, or no rule at all,
 *  leaves it a module. */
export function webpackAssetClassification(
  host: 'webpack' | 'next-webpack' | 'rspack',
  rules: readonly RuleEntry[] | undefined,
  version?: string
): HostAssetClassification {
  return {
    isAsset: (file, query) => {
      const found: Array<'opaque' | 'module'> = [];
      effects(rules, file, query, found);
      return found.length > 0 && found.every((effect) => effect === 'opaque');
    },
    resolverVersion: `${version ? `${host}@${version}` : host} captured`,
  };
}

/** esbuild's built-in loaders, which a configured `loader` map extends. */
const ESBUILD_DEFAULT_LOADERS = {
  '': 'js',
  '.js': 'js',
  '.mjs': 'js',
  '.cjs': 'js',
  '.jsx': 'jsx',
  '.ts': 'ts',
  '.cts': 'ts',
  '.mts': 'ts',
  '.tsx': 'tsx',
  '.css': 'css',
  '.module.css': 'local-css',
  '.json': 'json',
  '.txt': 'text',
} satisfies Readonly<Record<string, string>>;

/** esbuild loaders whose module is an opaque value: a URL, the file's bytes
 *  or text, or a stylesheet. `copy` keeps the file as code. */
const ESBUILD_OPAQUE_LOADERS = new Set([
  'file',
  'dataurl',
  'base64',
  'binary',
  'text',
  'css',
  'local-css',
  'global-css',
]);

/** esbuild's classification, from its `loader` map: the loader esbuild
 *  picks for a file is the longest extension of its name the map holds,
 *  exact case. */
export function esbuildAssetClassification(
  loader: Readonly<Record<string, string>> | undefined
): HostAssetClassification {
  const loaders = new Map(
    Object.entries({ ...ESBUILD_DEFAULT_LOADERS, ...loader })
  );
  return {
    isAsset: (file) => {
      let name = file.slice(
        Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\')) + 1
      );
      let picked = name.includes('.') ? undefined : loaders.get('');
      for (let dot = name.indexOf('.'); dot !== -1; dot = name.indexOf('.')) {
        picked = loaders.get(name.slice(dot));
        if (picked !== undefined) break;
        name = name.slice(dot + 1);
      }
      return picked !== undefined && ESBUILD_OPAQUE_LOADERS.has(picked);
    },
    resolverVersion: 'esbuild captured',
  };
}

/** Turbopack's classification under Next: Next's static-image table
 *  (`nextImageLoaderRegex`), unless `images.disableStaticImages`, and its
 *  stylesheets (`regexLikeCss`), as the installed `next` declares them.
 *  Built-in where Next cannot be read. */
export function nextImageAssetClassification(
  rootDir: string,
  disableStaticImages: boolean
): HostAssetClassification {
  try {
    const require = createRequire(`${rootDir}/package.json`);
    const { version } = require('next/package.json');
    const { nextImageLoaderRegex } = require('next/dist/build/webpack-config');
    const {
      regexLikeCss,
    } = require('next/dist/build/webpack/config/blocks/css');
    if (
      !(nextImageLoaderRegex instanceof RegExp) ||
      !(regexLikeCss instanceof RegExp)
    ) {
      return builtInAssetClassification(
        'hostOptionUnreadable',
        `next@${version} image and stylesheet types`
      );
    }
    return {
      isAsset: (file) =>
        regexLikeCss.test(file) ||
        (!disableStaticImages && nextImageLoaderRegex.test(file)),
      resolverVersion: `from next@${version}`,
    };
  } catch {
    return builtInAssetClassification('hostOptionUnreadable', 'next');
  }
}
