/**
 * Package resolution for discovery: one resolver, whose answers are the
 * host's where it resolves imports itself (spec §2.2 A4), and the system
 * loader's otherwise, and for a declared workspace the host cannot resolve.
 */

import { join } from 'path';

import { bareSpecifierPackageName } from './discover-packages';
import { extensionPolicyJson } from './host-extensions';

import type { EngineApi } from './engine-adapter';
import type { HostExtensionPolicy } from './host-extensions';
import type { WorkspacePackages } from './workspace-packages';

/** The host's own resolution of a specifier, from `importer` (absolute)
 *  where given, else from the root; null where it finds nothing. */
export type HostResolve = (
  specifier: string,
  importer?: string
) => Promise<string | null>;

export interface DiscoveryResolver {
  /** Whether a host answers first; without one the loader answers all. */
  readonly hostFirst: boolean;
  /** The entry file a package specifier names, absolute; null for none. */
  resolveSpecifier(specifier: string): Promise<string | null>;
  /** Why no file answers `specifier`, where the loader alone resolved it
   *  and said. */
  unresolvedReason(specifier: string): string | undefined;
  /** Whether only the loader resolved `specifier` while a host answers
   *  first. The host resolves such a package's imports only through a
   *  source-entry redirect, so the collector admits it only where one
   *  exists. */
  requireSourceEntry(specifier: string): boolean;
  /** The system loader's own answer from `fromDir`, as system evaluation
   *  resolves (spec §2.2 A3); null for none. */
  loaderResolve(specifier: string, fromDir: string): string | null;
}

/** A specifier from `fromDir` as the system loader resolves it under
 *  `context`, with the host's kit instances where given (C8): the file it
 *  names, or why it names none. */
export function nativeLoaderResolution(
  engine: Pick<EngineApi, 'resolveSpecifier'>,
  context: {
    conditions: readonly string[];
    workspaces: WorkspacePackages;
    extensions: HostExtensionPolicy;
    instances?: Readonly<Record<string, string>>;
  }
): (
  specifier: string,
  fromDir: string
) => { path?: string | null; unresolved?: string | null } {
  return (specifier, fromDir) =>
    engine.resolveSpecifier(
      specifier,
      fromDir,
      [...context.conditions],
      context.workspaces,
      extensionPolicyJson(context.extensions),
      context.instances
    );
}

/**
 * A declared workspace that nothing links into `node_modules` is no package
 * to the host, though the system loader resolves it: where the host finds
 * nothing, discovery asks the loader.
 */
export function discoveryResolver(
  hostResolve: HostResolve | null,
  engine: Pick<EngineApi, 'resolveSpecifier'>,
  context: {
    rootDir: string;
    conditions: readonly string[];
    workspaces: WorkspacePackages;
    extensions: HostExtensionPolicy;
  }
): DiscoveryResolver {
  const load = nativeLoaderResolution(engine, context);
  const loaderResolve = (specifier: string, fromDir: string): string | null =>
    load(specifier, fromDir).path ?? null;

  if (hostResolve === null) {
    const unresolved = new Map<string, string>();
    return {
      hostFirst: false,
      async resolveSpecifier(specifier) {
        const entry = load(specifier, context.rootDir);
        if (entry.path) return entry.path;
        unresolved.set(specifier, entry.unresolved ?? 'it names no file');
        return null;
      },
      unresolvedReason: (specifier) => unresolved.get(specifier),
      requireSourceEntry: () => false,
      loaderResolve,
    };
  }

  const loaderOnly = new Set<string>();
  // Discovery resolves from the root: a host asked without an importer
  // resolves from its own working directory or context, which can reach
  // another copy of the package.
  const rootImporter = join(context.rootDir, '__animus_discovery__.js');
  return {
    hostFirst: true,
    async resolveSpecifier(specifier) {
      let hosted: string | null;
      try {
        hosted = await hostResolve(specifier, rootImporter);
      } catch {
        // A host that fails is one that finds nothing: a declared
        // workspace still reaches the loader.
        hosted = null;
      }
      if (
        hosted !== null ||
        !Object.hasOwn(context.workspaces, bareSpecifierPackageName(specifier))
      ) {
        return hosted;
      }
      const loaded = loaderResolve(specifier, context.rootDir);
      if (loaded) loaderOnly.add(specifier);
      return loaded;
    },
    unresolvedReason: () => undefined,
    requireSourceEntry: (specifier) => loaderOnly.has(specifier),
    loaderResolve,
  };
}
