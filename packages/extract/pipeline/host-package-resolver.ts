/**
 * Package resolution for a host that resolves imports itself: the host's
 * answer first, the system loader's only for a declared workspace the host
 * cannot resolve.
 */

import { bareSpecifierPackageName } from './discover-packages';
import { extensionPolicyJson } from './host-extensions';

import type { EngineApi } from './engine-adapter';
import type { HostExtensionPolicy } from './host-extensions';
import type { WorkspacePackages } from './workspace-packages';

/** The host's own resolution of a package specifier; null where it finds
 *  nothing. */
export type HostResolve = (specifier: string) => Promise<string | null>;

export interface HostFirstResolver {
  resolveSpecifier(specifier: string): Promise<string | null>;
  /** Whether only the loader resolved `specifier`. The host resolves such a
   *  package's imports only through a source-entry redirect, so the
   *  collector admits it only where one exists. */
  requireSourceEntry(specifier: string): boolean;
}

/**
 * A declared workspace that nothing links into `node_modules` is no package
 * to the host, though the system loader resolves it: where the host finds
 * nothing, discovery asks the loader.
 */
export function hostFirstPackageResolver(
  hostResolve: HostResolve,
  engine: Pick<EngineApi, 'resolveSpecifier'>,
  context: {
    rootDir: string;
    conditions: readonly string[];
    workspaces: WorkspacePackages;
    extensions: HostExtensionPolicy;
  }
): HostFirstResolver {
  const loaderOnly = new Set<string>();
  return {
    async resolveSpecifier(specifier) {
      const hosted = await hostResolve(specifier);
      if (
        hosted !== null ||
        !Object.hasOwn(context.workspaces, bareSpecifierPackageName(specifier))
      ) {
        return hosted;
      }
      const loaded = engine.resolveSpecifier?.(
        specifier,
        context.rootDir,
        [...context.conditions],
        context.workspaces,
        extensionPolicyJson(context.extensions)
      );
      if (loaded?.path) loaderOnly.add(specifier);
      return loaded?.path ?? null;
    },
    requireSourceEntry: (specifier) => loaderOnly.has(specifier),
  };
}
