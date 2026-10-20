/** Module resolution for `animus types alias`: what a specifier names, seen
 *  from a declaration file's place in the packet. One owner, so the matcher,
 *  the anchor lookup, the import graph and the probe routing agree. */

import {
  bareSpecifierPackageName,
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

// ---------------------------------------------------------------------------
// package.json

type ExportsEntry =
  | string
  | null
  | ExportsEntry[]
  | { [condition: string]: ExportsEntry };

export interface PackageManifest {
  name?: string;
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

/** The conditions an ESM consumer's declaration lookup matches, as tsc
 *  applies them: the first matching key of each object, in its order. */
const TYPES_CONDITIONS = new Set(['types', 'import', 'module', 'default']);

function typesTarget(entry: ExportsEntry, underTypes: boolean): string | null {
  if (isPath(entry))
    return underTypes || /\.d\.(m|c)?ts$/.test(entry) ? entry : null;
  if (Array.isArray(entry)) {
    for (const item of entry) {
      const target = typesTarget(item, underTypes);
      if (target !== null) return target;
    }
    return null;
  }
  if (!isConditionMap(entry)) return null;
  for (const [condition, value] of Object.entries(entry)) {
    if (!TYPES_CONDITIONS.has(condition)) continue;
    const target = typesTarget(value, underTypes || condition === 'types');
    if (target !== null) return target;
  }
  return null;
}

export interface TypesRoute {
  /** `.` or `./sub`, `*` for a pattern. */
  subpath: string;
  /** The declaration target, relative to the package, `*` for a pattern. */
  target: string;
}

/** The declaration file each public subpath resolves to: `exports` when the
 *  package has it, else `types` / `typings`. */
export function packageTypesRoutes(manifest: PackageManifest): TypesRoute[] {
  const exportsField = manifest.exports;
  if (exportsField === undefined) {
    const field = manifest.types ?? manifest.typings;
    return field === undefined ? [] : [{ subpath: '.', target: field }];
  }
  const subpaths =
    isConditionMap(exportsField) &&
    Object.keys(exportsField).some((key) => key.startsWith('.'))
      ? Object.entries(exportsField).filter(([key]) => key.startsWith('.'))
      : [['.', exportsField] as const];
  const routes: TypesRoute[] = [];
  for (const [subpath, entry] of subpaths) {
    const target = typesTarget(entry, false);
    if (target !== null) routes.push({ subpath, target });
  }
  return routes;
}

// ---------------------------------------------------------------------------
// Identities

/** The files a relative module target can name, in TypeScript's order. */
function declarationCandidates(target: string): string[] {
  const stems: Array<[string, string[]]> = [];
  const jsExtension = /\.(m|c)?jsx?$/.exec(target);
  if (jsExtension !== null) {
    const stem = target.slice(0, -jsExtension[0].length);
    const flavor = jsExtension[1] ?? '';
    stems.push([stem, [`.d.${flavor}ts`, `.${flavor}ts`, '.tsx']]);
  }
  if (/\.d\.(m|c)?ts$/.test(target)) stems.push([target, ['']]);
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
 *  package directory and the matching `@types` directory, with the subpath:
 *  two files see the same declarations only when both resolve identically. */
export class ModuleIdentities {
  #identities = new Map<string, string | null>();
  #found = new Map<string, string | null>();
  #real = new Map<string, string>();
  #names = new Map<string, string | null>();

  constructor(
    /** Absolute final location of the packet root. */
    readonly packetRoot: string,
    /** Packet-relative paths of every declaration file. */
    readonly packetFiles: ReadonlySet<string>
  ) {}

  /** The identity of `specifier` imported from `fromFile`, or null when it
   *  does not resolve: a reference through it never matches. */
  identify(specifier: string, fromFile: string): string | null {
    const fromDir = dirname(fromFile);
    const key = `${fromDir}\0${specifier}`;
    const cached = this.#identities.get(key);
    if (cached !== undefined) return cached;
    let identity: string | null;
    if (isRelativeSpecifier(specifier)) {
      const file = this.resolveFile(resolve(fromDir, specifier));
      identity = file === null ? null : this.#fileIdentity(file);
    } else {
      identity = this.#packageIdentity(specifier, fromDir);
    }
    this.#identities.set(key, identity);
    return identity;
  }

  /** The packet-relative path `identity` names, if it is a packet file. */
  packetFile(identity: string | null): string | null {
    return identity?.startsWith('packet:')
      ? identity.slice('packet:'.length)
      : null;
  }

  /** The declaration file a relative target names: a packet path's place in
   *  the packet, or an existing file elsewhere. */
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

  /** The declaration file a bare specifier names from `fromDir`, through its
   *  package's `types` routing. */
  resolvePackageEntry(specifier: string, fromDir: string): string | null {
    const location = this.locatePackage(specifier, fromDir);
    const manifest =
      location === null ? null : readPackageManifest(location.dir);
    if (location === null || manifest === null) return null;
    const subpath = `.${specifier.slice(location.name.length)}`;
    const route = packageTypesRoutes(manifest).find(
      (candidate) => candidate.subpath === subpath
    );
    const target = route?.target ?? (subpath === '.' ? 'index.d.ts' : null);
    return target === null || target.includes('*')
      ? null
      : resolve(location.dir, target);
  }

  /** The package directory a bare specifier names from `fromDir`, with the
   *  name its package.json declares. */
  locatePackage(specifier: string, fromDir: string): PackageLocation | null {
    const dir = this.#findUp(
      fromDir,
      join('node_modules', bareSpecifierPackageName(specifier))
    );
    if (dir === null) return null;
    let name = this.#names.get(dir);
    if (name === undefined) {
      const declared = readPackageManifest(dir)?.name;
      name = declared === undefined || !isPath(declared) ? null : declared;
      this.#names.set(dir, name);
    }
    return name === null ? null : { dir, name };
  }

  #fileIdentity(file: string): string {
    return isPathWithinRoot(this.packetRoot, file)
      ? `packet:${toPosix(relative(this.packetRoot, file))}`
      : `file:${this.#realpath(file)}`;
  }

  #packageIdentity(specifier: string, fromDir: string): string | null {
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
    return `package:${runtime ?? ''}|${types ?? ''}|${specifier.slice(name.length)}`;
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
