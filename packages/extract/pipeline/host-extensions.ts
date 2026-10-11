import { EXTENSION_POLICY } from './extension-policy';

/**
 * The extension order a host resolver uses (spec §2.2 A2): the extensions it
 * appends to a specifier, in its order, and the source substitutions it
 * applies to an emitted extension (`./x.js` for `x.ts`). Each adapter
 * captures it from the host's resolved configuration, so extraction can open
 * the file the bundler loads.
 */
export interface HostExtensionPolicy {
  /** Appended to the base, then to `{base}/index`. */
  readonly appended: readonly string[];
  /** An emitted extension, and the source extensions it names, in order. */
  readonly nodeNext: ReadonlyArray<
    readonly [emitted: string, sources: readonly string[]]
  >;
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
    resolverVersion: label('vite', version, 'captured'),
  };
}

/** webpack's or Rspack's `resolve.extensions` (`...` standing for the
 *  bundler's defaults) and `resolve.extensionAlias`, the bundler's only
 *  substitution. An alias list naming the emitted extension keeps it as
 *  the literal spelling, which the policy tries first. */
export function webpackExtensionPolicy(
  host: string,
  resolve: {
    readonly extensions?: readonly string[];
    readonly extensionAlias?: Readonly<Record<string, string | string[]>>;
  },
  version?: string
): HostExtensionPolicy {
  const extensions = resolve.extensions;
  return {
    appended:
      extensions === undefined
        ? [...HOST_DEFAULT_EXTENSIONS.webpack]
        : extensions.flatMap((extension) =>
            extension === '...' ? HOST_DEFAULT_EXTENSIONS.webpack : [extension]
          ),
    nodeNext: Object.entries(resolve.extensionAlias ?? {}).map(
      ([emitted, aliases]) =>
        [
          emitted,
          (Array.isArray(aliases) ? aliases : [aliases]).filter(
            (alias) => alias !== emitted
          ),
        ] as const
    ),
    resolverVersion: label(
      host,
      version,
      extensions === undefined ? 'default' : 'captured'
    ),
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
  });
}
