/** Module resolution for `animus types alias`: what a specifier names, seen
 *  from a declaration file's place in the packet. One owner, so the matcher,
 *  the anchor lookup, the import graph and the route checks agree. */

import {
  bareSpecifierPackageName,
  findPackageRoot,
  isPathWithinRoot,
} from '@animus-ui/extract/pipeline';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export function toPosix(path: string): string {
  return path.split(sep).join('/');
}

export function isRelativeSpecifier(specifier: string): boolean {
  return (
    specifier === '.' ||
    specifier === '..' ||
    specifier.startsWith('./') ||
    specifier.startsWith('../') ||
    isAbsolute(specifier)
  );
}

export const DECLARATION_FILE = /\.d\.(m|c)?ts$/;

// ---------------------------------------------------------------------------
// package.json

type ExportsEntry =
  | string
  | null
  | ExportsEntry[]
  | { [condition: string]: ExportsEntry };

export interface PackageManifest {
  name?: string;
  type?: string;
  types?: string;
  typings?: string;
  exports?: ExportsEntry;
}

export function readPackageManifest(dir: string): PackageManifest | null {
  try {
    // SAFETY: every field read from it is checked with the guards below
    // before use.
    return JSON.parse(
      readFileSync(join(dir, 'package.json'), 'utf8')
    ) as PackageManifest;
  } catch {
    return null;
  }
}

function isPath(entry: ExportsEntry | undefined): entry is string {
  return entry === String(entry);
}

function isConditionMap(
  entry: ExportsEntry | undefined
): entry is { [condition: string]: ExportsEntry } {
  return entry instanceof Object && !Array.isArray(entry);
}

/** How a declaration file's imports resolve: an ESM file matches the
 *  `import` condition, a CommonJS one `require`. */
export type ModuleMode = 'import' | 'require';

const MODE_CONDITIONS = {
  import: new Set(['types', 'import', 'module', 'default']),
  require: new Set(['types', 'require', 'default']),
} satisfies Record<ModuleMode, ReadonlySet<string>>;

/** The target the first matching condition selects, as tsc reads `exports`:
 *  in each object's key order, with no fallback past a match. */
function conditionTarget(entry: ExportsEntry, mode: ModuleMode): string | null {
  if (isPath(entry)) return entry;
  if (Array.isArray(entry)) {
    for (const item of entry) {
      const target = conditionTarget(item, mode);
      if (target !== null) return target;
    }
    return null;
  }
  if (!isConditionMap(entry)) return null;
  for (const [condition, value] of Object.entries(entry)) {
    if (MODE_CONDITIONS[mode].has(condition))
      return conditionTarget(value, mode);
  }
  return null;
}

/** Every target any `types` condition names, matched or not. */
function typesConditionTargets(entry: ExportsEntry, out: string[]): void {
  if (Array.isArray(entry)) {
    for (const item of entry) typesConditionTargets(item, out);
    return;
  }
  if (!isConditionMap(entry)) return;
  for (const [condition, value] of Object.entries(entry)) {
    if (condition === 'types' && isPath(value)) out.push(value);
    else typesConditionTargets(value, out);
  }
}

export interface PackageRoute {
  /** `.` or `./sub`, `*` for a pattern. */
  subpath: string;
  /** What each mode selects, relative to the package, `*` for a pattern. */
  targets: Record<ModuleMode, string | null>;
  /** Every `types` condition's target, whether or not a mode selects it. */
  typesTargets: string[];
}

/** Each public subpath: `exports` when the package has it, else `types` /
 *  `typings` for the root. `gated` says whether the package's files are
 *  reachable only through these routes. */
export interface PackageRoutes {
  routes: PackageRoute[];
  gated: boolean;
}

export function packageRoutes(manifest: PackageManifest): PackageRoutes {
  const exportsField = manifest.exports;
  if (exportsField === undefined) {
    const field = manifest.types ?? manifest.typings ?? null;
    return {
      routes: [
        {
          subpath: '.',
          targets: { import: field, require: field },
          typesTargets: field === null ? [] : [field],
        },
      ],
      gated: false,
    };
  }
  const subpaths =
    isConditionMap(exportsField) &&
    Object.keys(exportsField).some((key) => key.startsWith('.'))
      ? Object.entries(exportsField).filter(([key]) => key.startsWith('.'))
      : [['.', exportsField] as const];
  return {
    routes: subpaths.map(([subpath, entry]) => {
      const typesTargets: string[] = [];
      typesConditionTargets(entry, typesTargets);
      return {
        subpath,
        targets: {
          import: conditionTarget(entry, 'import'),
          require: conditionTarget(entry, 'require'),
        },
        typesTargets,
      };
    }),
    gated: true,
  };
}

// ---------------------------------------------------------------------------
// Identities

/** The files a module target can name, in TypeScript's order: a script or
 *  TypeScript source target stands for its sibling declaration. */
export function declarationCandidates(target: string): string[] {
  const stems: Array<[string, string[]]> = [];
  const jsExtension = /\.(m|c)?jsx?$/.exec(target);
  if (jsExtension !== null) {
    const stem = target.slice(0, -jsExtension[0].length);
    const flavor = jsExtension[1] ?? '';
    stems.push([stem, [`.d.${flavor}ts`, `.${flavor}ts`, '.tsx']]);
  }
  if (DECLARATION_FILE.test(target)) {
    stems.push([target, ['']]);
  } else {
    // `allowImportingTsExtensions` sources keep `./x.ts` in emitted
    // declarations, and tsc reads it as `./x.d.ts`.
    const tsExtension = /\.(m|c)?tsx?$/.exec(target);
    if (tsExtension !== null) {
      const stem = target.slice(0, -tsExtension[0].length);
      stems.push([stem, [`.d.${tsExtension[1] ?? ''}ts`]], [target, ['']]);
    }
  }
  stems.push([target, ['.d.ts', '.ts', '.tsx', '.d.mts', '.d.cts']]);
  stems.push([`${target}/index`, ['.d.ts', '.ts', '.tsx']]);
  return stems.flatMap(([stem, extensions]) =>
    extensions.map((extension) => `${stem}${extension}`)
  );
}

export interface PackageLocation {
  dir: string;
  name: string;
}

/** Resolves import specifiers to identities, seen from a file's final
 *  location. Packet files are not on disk there yet, so relative targets
 *  inside the packet are checked against its file list.
 *
 *  A relative target's identity is its file; a bare specifier's is its
 *  package directory and the matching `@types` directory, with the subpath
 *  and the importing file's module mode: an ESM and a CommonJS view of one
 *  package may be different declarations, so they never match. */
export class ModuleIdentities {
  #identities = new Map<string, string | null>();
  #found = new Map<string, string | null>();
  #real = new Map<string, string>();
  #manifests = new Map<string, PackageManifest | null>();
  #modes = new Map<string, ModuleMode>();

  constructor(
    /** Absolute final location of the packet root. */
    readonly packetRoot: string,
    /** Packet-relative paths of every declaration file. */
    readonly packetFiles: ReadonlySet<string>
  ) {}

  /** The identity of `specifier` imported from `fromFile`, or null when it
   *  does not resolve: a reference through it never matches. */
  identify(specifier: string, fromFile: string): string | null {
    const mode = this.modeOf(fromFile);
    const fromDir = dirname(fromFile);
    const key = `${fromDir}\0${mode}\0${specifier}`;
    const cached = this.#identities.get(key);
    if (cached !== undefined) return cached;
    let identity: string | null;
    if (isRelativeSpecifier(specifier)) {
      const file = this.resolveFile(resolve(fromDir, specifier));
      identity = file === null ? null : this.#fileIdentity(file);
    } else {
      identity = this.#packageIdentity(specifier, fromDir, mode);
    }
    this.#identities.set(key, identity);
    return identity;
  }

  /** The declaration file `specifier` names from `fromFile`: what the import
   *  graph follows. */
  resolveImport(specifier: string, fromFile: string): string | null {
    return isRelativeSpecifier(specifier)
      ? this.resolveFile(resolve(dirname(fromFile), specifier))
      : this.resolvePackageEntry(
          specifier,
          dirname(fromFile),
          this.modeOf(fromFile)
        );
  }

  /** `.d.mts` is ESM and `.d.cts` CommonJS; any other file takes its
   *  package's `type`. */
  modeOf(file: string): ModuleMode {
    if (/\.d\.mts$|\.mts$/.test(file)) return 'import';
    if (/\.d\.cts$|\.cts$/.test(file)) return 'require';
    // Memoized by directory: every file there shares its package.
    const dir = dirname(file);
    let mode = this.#modes.get(dir);
    if (mode === undefined) {
      const root = findPackageRoot(file);
      mode = this.manifest(root)?.type === 'module' ? 'import' : 'require';
      this.#modes.set(dir, mode);
    }
    return mode;
  }

  manifest(dir: string): PackageManifest | null {
    let manifest = this.#manifests.get(dir);
    if (manifest === undefined) {
      manifest = readPackageManifest(dir);
      this.#manifests.set(dir, manifest);
    }
    return manifest;
  }

  /** The packet-relative path `identity` names, if it is a packet file. */
  packetFile(identity: string | null): string | null {
    return identity?.startsWith('packet:')
      ? identity.slice('packet:'.length)
      : null;
  }

  /** The declaration file a target names: a packet path's place in the
   *  packet, or an existing file elsewhere. */
  resolveFile(target: string): string | null {
    const inPacket = isPathWithinRoot(this.packetRoot, target);
    for (const candidate of declarationCandidates(target)) {
      if (
        inPacket
          ? this.packetFiles.has(toPosix(relative(this.packetRoot, candidate)))
          : existsSync(candidate)
      ) {
        return candidate;
      }
    }
    return null;
  }

  /** The declaration file a bare specifier names from `fromDir`, through the
   *  route its package gives `mode`. */
  resolvePackageEntry(
    specifier: string,
    fromDir: string,
    mode: ModuleMode
  ): string | null {
    const location = this.locatePackage(specifier, fromDir);
    const manifest = location === null ? null : this.manifest(location.dir);
    if (location === null || manifest === null) return null;
    const subpath = `.${specifier.slice(location.name.length)}`;
    const route = packageRoutes(manifest).routes.find(
      (candidate) => candidate.subpath === subpath
    );
    const target =
      route?.targets[mode] ?? (subpath === '.' ? 'index.d.ts' : null);
    return target === null || target.includes('*')
      ? null
      : this.resolveFile(resolve(location.dir, target));
  }

  /** The package directory a bare specifier names from `fromDir`, with the
   *  name its package.json declares. */
  locatePackage(specifier: string, fromDir: string): PackageLocation | null {
    const dir = this.#findUp(
      fromDir,
      join('node_modules', bareSpecifierPackageName(specifier))
    );
    const declared = dir === null ? undefined : this.manifest(dir)?.name;
    return dir === null || declared === undefined || !isPath(declared)
      ? null
      : { dir, name: declared };
  }

  #fileIdentity(file: string): string {
    return isPathWithinRoot(this.packetRoot, file)
      ? `packet:${toPosix(relative(this.packetRoot, file))}`
      : `file:${this.#realpath(file)}`;
  }

  #packageIdentity(
    specifier: string,
    fromDir: string,
    mode: ModuleMode
  ): string | null {
    if (specifier.startsWith('node:')) return `builtin:${specifier}`;
    const name = bareSpecifierPackageName(specifier);
    const runtime = this.#findUp(fromDir, join('node_modules', name));
    const types = this.#findUp(
      fromDir,
      join(
        'node_modules',
        name.startsWith('@')
          ? `@types/${name.slice(1).replace('/', '__')}`
          : `@types/${name}`
      )
    );
    if (runtime === null && types === null) return null;
    return `package:${runtime ?? ''}|${types ?? ''}|${specifier.slice(name.length)}|${mode}`;
  }

  /** The real path of the nearest `entry` above `fromDir`, memoized per
   *  directory: siblings share their parents' answers. */
  #findUp(fromDir: string, entry: string): string | null {
    const key = `${fromDir}\0${entry}`;
    const cached = this.#found.get(key);
    if (cached !== undefined) return cached;
    const candidate = join(fromDir, entry);
    const parent = dirname(fromDir);
    const found = existsSync(candidate)
      ? this.#realpath(candidate)
      : parent === fromDir
        ? null
        : this.#findUp(parent, entry);
    this.#found.set(key, found);
    return found;
  }

  #realpath(path: string): string {
    let real = this.#real.get(path);
    if (real === undefined) {
      real = realpathSync.native(path);
      this.#real.set(path, real);
    }
    return real;
  }
}
