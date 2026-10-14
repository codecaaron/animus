/**
 * What every host adapter shares: file identity by realpath, which files
 * the plan owns (declared sheets, and listed dependencies by the package
 * that holds them), whether a stylesheet reaches an owned file, and how a
 * diagnostic prints.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';

import { readSheet } from './sheet';

import type { LayergateDiagnostic, ParsedSheet } from './compile';
import type { LayergatePlan } from './plan';
import type { ImportStatement, Sheet } from './sheet';

/** A path with forward slashes, normalized. */
export const slashes = (path: string) =>
  posix.normalize(path.replace(/\\/g, '/'));

/** A path through symlinks, with forward slashes. */
export function real(path: string): string {
  try {
    return slashes(realpathSync(path));
  } catch {
    return slashes(path);
  }
}

/** A module id's file, without its query, by realpath. */
export const fileOf = (id: string) => real(id.split('?')[0]!);

/** Resolves each of `specifiers`, a plan's `what` list, with `resolveOne`;
 *  one that resolves to nothing fails, naming it. */
export function resolveEach(
  specifiers: readonly string[],
  what: string,
  root: string,
  resolveOne: (specifier: string) => Promise<string | null>
): Promise<string[]> {
  return Promise.all(
    specifiers.map(async (specifier) => {
      const file = await resolveOne(specifier);
      if (!file) {
        throw new Error(
          `[layergate] ${what}: cannot resolve "${specifier}" from ${root}`
        );
      }
      return file;
    })
  );
}

interface PackageInfo {
  dir: string;
  name: string;
}

/** The nearest `package.json` above `dir`: its directory and name. */
function packageOf(
  dir: string,
  cache: Map<string, PackageInfo | null>
): PackageInfo | null {
  const visited: string[] = [];
  let current = dir;
  let found: PackageInfo | null = null;
  for (;;) {
    if (cache.has(current)) {
      found = cache.get(current)!;
      break;
    }
    visited.push(current);
    try {
      // SAFETY: a package.json, whose `name`, when present, is a string.
      const { name } = JSON.parse(
        readFileSync(join(current, 'package.json'), 'utf8')
      ) as { name?: string };
      found = { dir: current, name: name ?? '' };
      break;
    } catch {
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  for (const dirVisited of visited) cache.set(dirVisited, found);
  return found;
}

/** Which files a plan owns, by realpath: a declared sheet, or a file of a
 *  listed dependency, a package other than the app's (`root`'s). */
export function ownership(plan: LayergatePlan) {
  const packages = new Map<string, PackageInfo | null>();
  let app: PackageInfo | null = null;
  let declared: string[] = [];
  return {
    /** Sets the app root and the declared sheets, by realpath. */
    reset(root: string, sheets: string[]) {
      app = packageOf(real(root), packages);
      declared = sheets;
    },
    get declared(): readonly string[] {
      return declared;
    },
    /** Whether the plan can own anything at all. */
    owning: () => declared.length > 0 || plan.dependencies !== false,
    owns(file: string): boolean {
      if (declared.includes(file)) return true;
      if (plan.dependencies === false) return false;
      const owner = packageOf(dirname(file), packages);
      if (!owner || owner.dir === app?.dir) return false;
      return plan.dependencies === true || plan.dependencies.has(owner.name);
    },
  };
}

export interface ReachOptions {
  /** The file an `@import` in `importer` reaches, or null. */
  resolve(specifier: string, importer: string): Promise<string | null>;
  read(file: string): Promise<string>;
  owns(file: string): boolean;
  /** Parsed files to reuse. */
  parsed?: ReadonlyMap<string, { sheet: Sheet }>;
}

/** Whether the stylesheet `file`, whose `@import`s are `imports`, reaches
 *  an owned file: resolved only, never compiled. */
export async function reachesOwned(
  file: string,
  imports: readonly ImportStatement[],
  options: ReachOptions,
  seen = new Set<string>()
): Promise<boolean> {
  if (seen.has(file)) return false;
  seen.add(file);
  if (options.owns(file)) return true;
  for (const statement of imports) {
    const child = await options.resolve(statement.url, file);
    if (!child) continue;
    const sheet =
      options.parsed?.get(child)?.sheet ??
      readSheet(await options.read(child).catch(() => ''));
    if (await reachesOwned(child, sheet.imports, options, seen)) return true;
  }
  return false;
}

/**
 * What a host keeps between compiles: parsed files, the files each
 * finished stylesheet (a unit) read, and whether a stylesheet reaches an
 * owned file, each kept until a file it depends on changes.
 */
export class Units {
  /** Parsed files, for `compileUnit`'s `cache`. */
  readonly parsed = new Map<string, ParsedSheet>();
  private readonly filesByUnit = new Map<string, Set<string>>();
  private readonly unitsByFile = new Map<string, Set<string>>();
  private readonly reached = new Map<string, boolean>();
  private readonly realpaths = new Map<string, string>();

  /** `file` by realpath, the identity ownership, opt-outs and the declared
   *  sheets are decided by, wherever a host reads it from. */
  canonical(file: string): string {
    let path = this.realpaths.get(file);
    if (path === undefined) this.realpaths.set(file, (path = real(file)));
    return path;
  }

  /** Records the files `unit` read. Returns the files no unit reads any
   *  more, whose parses are forgotten. */
  record(unit: string, files: readonly string[]): string[] {
    const current = new Set(files);
    const forgotten: string[] = [];
    for (const file of this.filesByUnit.get(unit) ?? []) {
      if (current.has(file)) continue;
      const units = this.unitsByFile.get(file);
      units?.delete(unit);
      if (units?.size === 0) {
        this.unitsByFile.delete(file);
        this.parsed.delete(file);
        forgotten.push(file);
      }
    }
    this.filesByUnit.set(unit, current);
    for (const file of current) {
      let units = this.unitsByFile.get(file);
      if (!units) this.unitsByFile.set(file, (units = new Set()));
      units.add(unit);
    }
    return forgotten;
  }

  /** Whether a finished stylesheet read `file`. */
  reads(file: string): boolean {
    return this.unitsByFile.has(file);
  }

  /** Forgets `file`'s parse and every reach answer, and returns the units
   *  that read it. */
  changed(file: string): ReadonlySet<string> {
    this.parsed.delete(file);
    this.realpaths.delete(file);
    this.reached.clear();
    return this.unitsByFile.get(file) ?? new Set();
  }

  /** `reachesOwned`, answered once per file until a file changes. */
  async reaches(
    file: string,
    imports: readonly ImportStatement[],
    options: Omit<ReachOptions, 'parsed'>
  ): Promise<boolean> {
    let reached = this.reached.get(file);
    if (reached === undefined) {
      reached = await reachesOwned(file, imports, {
        ...options,
        parsed: this.parsed,
      });
      this.reached.set(file, reached);
    }
    return reached;
  }
}

export function formatDiagnostic(diagnostic: LayergateDiagnostic): string {
  const where = diagnostic.file
    ? `${diagnostic.file}${diagnostic.line ? `:${diagnostic.line}:${diagnostic.column}` : ''}: `
    : '';
  return `[layergate] ${where}${diagnostic.message} [${diagnostic.code}]`;
}
