import { EXTENSION_POLICY } from './extension-policy';

import type { ExtensionOrder } from './extension-policy';

/**
 * The extension order a host resolver uses (spec §2.2 A2): the extensions it
 * appends to a specifier, in its order, and the source substitutions it
 * applies to an emitted extension (`./x.js` for `x.ts`). Each adapter
 * captures it from the host's resolved configuration, so extraction can open
 * the file the bundler loads.
 */
export interface HostExtensionPolicy extends ExtensionOrder {
  /** Where the order came from: `<host>[@version] captured` when read from
   *  the host's resolved configuration, `<host>[@version] default` when the
   *  host sets none and runs its documented default, or `built-in` where no
   *  host resolves (the CLI, direct engine calls) or, with the reason
   *  `hostOptionUnreadable` (spec §2.2 A2), where the host has an order the
   *  adapter cannot read (`built-in (hostOptionUnreadable:
   *  rollup-node-resolve)`). */
  readonly resolverVersion: string;
}

/** Animus's own order, where no host resolver configuration exists. */
export const BUILT_IN_EXTENSION_POLICY: HostExtensionPolicy = {
  appended: EXTENSION_POLICY.appended,
  nodeNext: EXTENSION_POLICY.nodeNext,
  alias: [],
  resolverVersion: 'built-in',
};

type Substitutions = HostExtensionPolicy['nodeNext'];

/** The TypeScript output a source compiles to, as a host that resolves an
 *  emitted extension to its TypeScript source reads it. */
const TYPESCRIPT_OUTPUTS: Substitutions = [
  ['.js', ['.ts', '.tsx']],
  ['.jsx', ['.tsx']],
  ['.mjs', ['.mts']],
  ['.cjs', ['.cts']],
];

/** esbuild's rewritten file extensions, which also let `.jsx` name `.ts`. */
const ESBUILD_OUTPUTS: Substitutions = [
  ['.js', ['.ts', '.tsx']],
  ['.jsx', ['.ts', '.tsx']],
  ['.mjs', ['.mts']],
  ['.cjs', ['.cts']],
];

/** Documented defaults, for a host whose resolved order is not readable. */
export const HOST_DEFAULT_EXTENSIONS = {
  vite: ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json'],
  webpack: ['.js', '.json', '.wasm'],
  /** Rspack 1's documented default; later versions document another. */
  rspack1: ['.js', '.json', '.wasm'],
  turbopack: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'],
  esbuild: ['.tsx', '.ts', '.jsx', '.js', '.css', '.json'],
} as const;

function label(
  host: string,
  version: string | undefined,
  how: 'captured' | 'default'
): string {
  return `${version ? `${host}@${version}` : host} ${how}`;
}

/** Vite's `resolve.extensions`, which `configResolved` holds with its
 *  defaults applied. A TypeScript importer's `./x.js` names `x.ts` too. */
export function viteExtensionPolicy(
  extensions: readonly string[],
  version?: string
): HostExtensionPolicy {
  return {
    appended: [...extensions],
    nodeNext: TYPESCRIPT_OUTPUTS,
    alias: [],
    resolverVersion: label('vite', version, 'captured'),
  };
}

/** One `resolve` block of webpack's or Rspack's configuration. */
interface WebpackResolveBlock {
  readonly extensions?: readonly string[];
  readonly extensionAlias?: Readonly<Record<string, string | string[]>>;
}

/** webpack's or Rspack's resolved order for an ESM import: the root
 *  `resolve` with `byDependency.esm` merged over it as the bundler merges
 *  it, a `...` standing for what it extends. `extensionAlias` is kept whole
 *  and in order. Where neither sets extensions, the bundler's documented
 *  default stands in; for Rspack only version 1's is known. */
export function webpackExtensionPolicy(
  host: string,
  resolve: WebpackResolveBlock & {
    readonly byDependency?: Readonly<
      Record<string, WebpackResolveBlock | undefined>
    >;
  },
  version?: string
): HostExtensionPolicy {
  const esm = resolve.byDependency?.esm;
  const unset =
    resolve.extensions === undefined && esm?.extensions === undefined;
  const rspack = host === 'rspack';
  const defaults: readonly string[] | null = !rspack
    ? HOST_DEFAULT_EXTENSIONS.webpack
    : version?.startsWith('1.')
      ? HOST_DEFAULT_EXTENSIONS.rspack1
      : null;
  // A string alias value is read by the bundler in ways no capture here
  // models (a literal '...' suffix among them), so the order is unreadable.
  const aliasValues = [
    ...Object.values(resolve.extensionAlias ?? {}),
    ...Object.values(esm?.extensionAlias ?? {}),
  ];
  if (aliasValues.some((value) => !Array.isArray(value))) {
    return {
      ...BUILT_IN_EXTENSION_POLICY,
      resolverVersion: 'built-in (hostOptionUnreadable: string extensionAlias)',
    };
  }
  // The effective order reaches the bundler's defaults unless a list
  // without `...` replaces them; one that reaches unknown defaults is
  // unreadable, however much of it is configured.
  const extendsBase = (list: readonly string[] | undefined): boolean =>
    list === undefined || list.includes('...');
  if (
    defaults === null &&
    extendsBase(esm?.extensions) &&
    extendsBase(resolve.extensions)
  ) {
    return {
      ...BUILT_IN_EXTENSION_POLICY,
      resolverVersion: `built-in (hostOptionUnreadable: ${host}${version ? `@${version}` : ''} defaults)`,
    };
  }
  const extend = (
    list: readonly string[] | undefined,
    base: readonly string[]
  ): readonly string[] =>
    list === undefined
      ? base
      : list.flatMap((extension) => (extension === '...' ? base : [extension]));
  const root = extend(resolve.extensions, defaults ?? []);
  // A nested alias's `...` stands for its extension's root sequence, as the
  // bundler merges `byDependency` over the root; the root's own `...` is the
  // bundler's default, which aliases nothing.
  const sequence = (value: string | string[]): readonly string[] =>
    Array.isArray(value) ? value : [value];
  const alias = new Map<string, readonly string[]>(
    Object.entries(resolve.extensionAlias ?? {}).map(([emitted, value]) => [
      emitted,
      sequence(value).filter((extension) => extension !== '...'),
    ])
  );
  for (const [emitted, value] of Object.entries(esm?.extensionAlias ?? {})) {
    const base = alias.get(emitted) ?? [];
    alias.set(
      emitted,
      sequence(value).flatMap((extension) =>
        extension === '...' ? base : [extension]
      )
    );
  }
  return {
    appended: [...extend(esm?.extensions, root)],
    nodeNext: [],
    alias: [...alias].map(
      ([emitted, extensions]) => [emitted, [...extensions]] as const
    ),
    resolverVersion: label(host, version, unset ? 'default' : 'captured'),
  };
}

/** Turbopack's `turbopack.resolveExtensions`, or its documented default
 *  when the Next config sets none. It substitutes no source: under Next
 *  16.3, `./x.js` beside only `x.ts` names no module. */
export function turbopackExtensionPolicy(
  resolveExtensions: readonly string[] | undefined,
  nextVersion?: string
): HostExtensionPolicy {
  return {
    appended: [...(resolveExtensions ?? HOST_DEFAULT_EXTENSIONS.turbopack)],
    nodeNext: [],
    alias: [],
    resolverVersion: label(
      'turbopack',
      nextVersion,
      resolveExtensions === undefined ? 'default' : 'captured'
    ),
  };
}

/** esbuild's `resolveExtensions`, or its default when the build sets none. */
export function esbuildExtensionPolicy(
  resolveExtensions: readonly string[] | undefined,
  version?: string
): HostExtensionPolicy {
  return {
    appended: [...(resolveExtensions ?? HOST_DEFAULT_EXTENSIONS.esbuild)],
    nodeNext: ESBUILD_OUTPUTS,
    alias: [],
    resolverVersion: label(
      'esbuild',
      version,
      resolveExtensions === undefined ? 'default' : 'captured'
    ),
  };
}

/** Rollup leaves the extension order to its resolver plugins, which keep
 *  their options private: a TypeScript build sets `@rollup/plugin-node-resolve`'s
 *  `extensions`, which no documented default matches. The built-in policy
 *  answers, with the reason. */
export function rollupExtensionPolicy(
  usesNodeResolve: boolean
): HostExtensionPolicy {
  return {
    ...BUILT_IN_EXTENSION_POLICY,
    resolverVersion: usesNodeResolve
      ? 'built-in (hostOptionUnreadable: rollup-node-resolve)'
      : 'built-in (hostOptionUnreadable: rollup resolver plugins)',
  };
}

/** The policy as the system loader reads it (`ExtensionPolicy`). */
export function extensionPolicyJson(policy: HostExtensionPolicy): string {
  return JSON.stringify({
    appended: policy.appended,
    nodeNext: policy.nodeNext,
    alias: policy.alias,
  });
}
