import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

export const PUBLISHABLE_PACKAGE_NAMES = [
  '@animus-ui/properties',
  '@animus-ui/system',
  '@animus-ui/extract',
  '@animus-ui/vite-plugin',
  '@animus-ui/next-plugin',
] as const;

const INTERNAL_PREFIX = '@animus-ui/';
const EXTRACT_PLATFORM_PREFIX = '@animus-ui/extract-';

export type PackageManifest = {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

export type ManifestEdgeDiagnostic = {
  dependent: string;
  dependency: string;
  declaredVersion: string;
  expectedVersion: string;
};

export type InstalledGraphDiagnostic = {
  packageName: string;
  installedVersion: string;
  expectedVersion: string;
  path: string;
};

export type TarballInputs =
  | { mode: 'local'; tarballs: Map<string, string> }
  | { mode: 'supplied'; tarballs: Map<string, string>; tarballsDir: string };

function isInternalPackage(name: string): boolean {
  return (
    PUBLISHABLE_PACKAGE_NAMES.includes(
      name as (typeof PUBLISHABLE_PACKAGE_NAMES)[number]
    ) || name.startsWith(EXTRACT_PLATFORM_PREFIX)
  );
}

export function expectedVersionsFromManifests(
  manifests: ReadonlyMap<string, PackageManifest>
): Map<string, string> {
  const expected = new Map<string, string>();
  for (const manifest of manifests.values()) {
    if (isInternalPackage(manifest.name)) {
      expected.set(manifest.name, manifest.version);
    }
  }

  const extract = manifests.get('@animus-ui/extract');
  if (extract) {
    for (const dependency of Object.keys(extract.optionalDependencies ?? {})) {
      if (dependency.startsWith(EXTRACT_PLATFORM_PREFIX)) {
        expected.set(dependency, extract.version);
      }
    }
  }
  return expected;
}

export function validateInternalManifestEdges(
  manifests: ReadonlyMap<string, PackageManifest>
): ManifestEdgeDiagnostic[] {
  const diagnostics: ManifestEdgeDiagnostic[] = [];
  const expectedVersions = expectedVersionsFromManifests(manifests);

  for (const manifest of manifests.values()) {
    const edgeGroups = [
      manifest.dependencies,
      manifest.optionalDependencies,
      manifest.peerDependencies,
    ];
    for (const edges of edgeGroups) {
      for (const [dependency, declaredVersion] of Object.entries(edges ?? {})) {
        if (!dependency.startsWith(INTERNAL_PREFIX)) continue;

        const expectedVersion = expectedVersions.get(dependency);
        if (!isInternalPackage(dependency) || expectedVersion === undefined) {
          diagnostics.push({
            dependent: manifest.name,
            dependency,
            declaredVersion,
            expectedVersion: '<no tested tarball>',
          });
        } else if (declaredVersion !== expectedVersion) {
          diagnostics.push({
            dependent: manifest.name,
            dependency,
            declaredVersion,
            expectedVersion,
          });
        }
      }
    }
  }

  return diagnostics;
}

function findInstalledInternalPackages(root: string): string[] {
  const packages: string[] = [];

  function visit(directory: string): void {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }

    if (basename(directory) === 'node_modules') {
      const scopeDirectory = join(directory, '@animus-ui');
      try {
        for (const entry of readdirSync(scopeDirectory, {
          withFileTypes: true,
        })) {
          if (entry.isDirectory() || entry.isSymbolicLink()) {
            packages.push(join(scopeDirectory, entry.name));
          }
        }
      } catch {
        // This node_modules tree has no installed @animus-ui packages.
      }
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === '.bin') continue;
      visit(join(directory, entry.name));
    }
  }

  visit(resolve(root));
  return packages.sort();
}

export function validateInstalledInternalGraph(
  root: string,
  expectedVersions: ReadonlyMap<string, string>
): InstalledGraphDiagnostic[] {
  const diagnostics: InstalledGraphDiagnostic[] = [];

  for (const packagePath of findInstalledInternalPackages(root)) {
    if (lstatSync(packagePath).isSymbolicLink()) {
      diagnostics.push({
        packageName: `${INTERNAL_PREFIX}${basename(packagePath)}`,
        installedVersion: '<workspace symlink>',
        expectedVersion: '<packed package>',
        path: packagePath,
      });
      continue;
    }

    let manifest: PackageManifest;
    try {
      manifest = JSON.parse(
        readFileSync(join(packagePath, 'package.json'), 'utf8')
      ) as PackageManifest;
    } catch {
      diagnostics.push({
        packageName: `${INTERNAL_PREFIX}${basename(packagePath)}`,
        installedVersion: '<unreadable manifest>',
        expectedVersion: '<tested version>',
        path: packagePath,
      });
      continue;
    }

    const expectedVersion = expectedVersions.get(manifest.name);
    if (expectedVersion === undefined || manifest.version !== expectedVersion) {
      diagnostics.push({
        packageName: manifest.name,
        installedVersion: manifest.version,
        expectedVersion: expectedVersion ?? '<no tested tarball>',
        path: packagePath,
      });
    }
  }

  return diagnostics;
}

function tarballPattern(packageName: string): RegExp {
  const unscopedName = packageName.slice(INTERNAL_PREFIX.length);
  return new RegExp(
    `^animus-ui-${unscopedName}(?:-[0-9][0-9A-Za-z.+-]*)?\\.tgz$`
  );
}

export function resolveTarballInputs(args: readonly string[]): TarballInputs {
  if (args.length === 0) {
    return { mode: 'local', tarballs: new Map() };
  }
  if (args[0] !== '--tarballs-dir') {
    throw new Error(`unknown argument '${args[0]}'`);
  }
  if (args.length !== 2 || !args[1]) {
    throw new Error('expected exactly: --tarballs-dir <path>');
  }

  const tarballsDir = resolve(args[1]);
  let entries: string[];
  try {
    entries = readdirSync(tarballsDir);
  } catch {
    throw new Error(`tarballs directory is not readable: ${tarballsDir}`);
  }

  const tarballs = new Map<string, string>();
  for (const packageName of PUBLISHABLE_PACKAGE_NAMES) {
    const matches = entries.filter((entry) =>
      tarballPattern(packageName).test(entry)
    );
    if (matches.length === 0) {
      throw new Error(`missing tarball for ${packageName} in ${tarballsDir}`);
    }
    if (matches.length > 1) {
      throw new Error(
        `multiple tarballs for ${packageName} in ${tarballsDir}: ${matches.join(', ')}`
      );
    }
    tarballs.set(packageName, join(tarballsDir, matches[0]));
  }

  return { mode: 'supplied', tarballs, tarballsDir };
}

function manifestFromTarball(path: string): PackageManifest {
  const result = spawnSync('tar', ['-xzOf', path, 'package/package.json'], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(
      `cannot read package/package.json from ${path}: ${result.stderr.trim()}`
    );
  }
  return JSON.parse(result.stdout) as PackageManifest;
}

function manifestsFromTarballs(
  paths: readonly string[]
): Map<string, PackageManifest> {
  const manifests = new Map<string, PackageManifest>();
  for (const path of paths) {
    const manifest = manifestFromTarball(path);
    manifests.set(manifest.name, manifest);
  }
  return manifests;
}

function printManifestDiagnostics(diagnostics: ManifestEdgeDiagnostic[]): void {
  for (const diagnostic of diagnostics) {
    console.error(
      `ERROR: ${diagnostic.dependent} declares ${diagnostic.dependency}@${diagnostic.declaredVersion}; expected ${diagnostic.expectedVersion}`
    );
  }
}

function printInstalledDiagnostics(
  diagnostics: InstalledGraphDiagnostic[]
): void {
  for (const diagnostic of diagnostics) {
    console.error(
      `ERROR: ${diagnostic.packageName} installed ${diagnostic.installedVersion}; expected ${diagnostic.expectedVersion} at ${diagnostic.path}`
    );
  }
}

function main(args: readonly string[]): number {
  const [command, ...rest] = args;
  if (
    command !== 'resolve' &&
    command !== 'manifests' &&
    command !== 'installed'
  ) {
    console.error(
      'ERROR: usage: packed-graph.ts resolve [--tarballs-dir <path>] | manifests <tarball...> | installed <root> <tarball...>'
    );
    return 1;
  }

  try {
    if (command === 'resolve') {
      const inputs = resolveTarballInputs(rest);
      console.log(`mode\t${inputs.mode}`);
      for (const [packageName, path] of inputs.tarballs) {
        console.log(`tarball\t${packageName}\t${path}`);
      }
      return 0;
    }

    if (command === 'manifests') {
      const diagnostics = validateInternalManifestEdges(
        manifestsFromTarballs(rest)
      );
      printManifestDiagnostics(diagnostics);
      return diagnostics.length === 0 ? 0 : 1;
    }

    const [root, ...tarballs] = rest;
    if (!root) throw new Error('installed graph root is required');
    const manifests = manifestsFromTarballs(tarballs);
    const diagnostics = validateInstalledInternalGraph(
      root,
      expectedVersionsFromManifests(manifests)
    );
    printInstalledDiagnostics(diagnostics);
    return diagnostics.length === 0 ? 0 : 1;
  } catch (error) {
    console.error(`ERROR: ${(error as Error).message}`);
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = main(process.argv.slice(2));
}
