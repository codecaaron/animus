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
   *  host has one the adapter cannot read and its documented default
   *  stands in, or `built-in` where no host resolves (the CLI, direct engine
   *  calls). */
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
  rollupNodeResolve: ['.mjs', '.js', '.json', '.node'],
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
 *  when the Next config sets none. */
export function turbopackExtensionPolicy(
  resolveExtensions: readonly string[] | undefined,
  nextVersion?: string
): HostExtensionPolicy {
  return {
    appended: [...(resolveExtensions ?? HOST_DEFAULT_EXTENSIONS.turbopack)],
    nodeNext: TYPESCRIPT_OUTPUTS,
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

/** Rollup appends no extension of its own; `@rollup/plugin-node-resolve`
 *  does, and keeps its options private, so its documented default stands
 *  in when the build uses it. Neither substitutes a source. */
export function rollupExtensionPolicy(
  usesNodeResolve: boolean,
  version?: string
): HostExtensionPolicy {
  return usesNodeResolve
    ? {
        appended: [...HOST_DEFAULT_EXTENSIONS.rollupNodeResolve],
        nodeNext: [],
        resolverVersion: label('rollup-node-resolve', version, 'default'),
      }
    : {
        appended: [],
        nodeNext: [],
        resolverVersion: label('rollup', version, 'captured'),
      };
}

/** The policy as the system loader reads it (`ExtensionPolicy`). */
export function extensionPolicyJson(policy: HostExtensionPolicy): string {
  return JSON.stringify({
    appended: policy.appended,
    nodeNext: policy.nodeNext,
  });
}
