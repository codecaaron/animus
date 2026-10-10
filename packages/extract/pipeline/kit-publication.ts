import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import {
  bareSpecifierPackageName,
  exportsSubpaths,
  KIT_SOURCE_CONDITION,
} from './discover-packages';
import { parseInternalWire } from './internal-wire';
import { relativeSourceCandidates } from './source-ingestion';
import { isJsonBlock, isJsonString } from './tsconfig-paths';

import type { JsonValue } from './tsconfig-paths';

/** The engine's run-time module specifiers per file. */
export interface ModuleSpecifierReader {
  moduleSpecifiers?: (fileEntriesJson: string) => string;
}

/** Source a kit publishes and the loader or a bundler parses for imports. */
const CODE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
]);

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

const posixPath = (path: string) => path.split(sep).join('/');

/** The files `npm pack` publishes, or why npm could not list them. */
type PublishedFiles =
  | { kind: 'listed'; files: Set<string> }
  | { kind: 'failed'; reason: string };

/**
 * The package-relative files `npm pack` publishes, read with npm's own rules
 * (`files`, `.npmignore`, `.gitignore` and the files npm always includes)
 * through a dry run that runs no scripts and needs no network.
 */
function npmPublishedFiles(pkgRoot: string): PublishedFiles {
  const windows = process.platform === 'win32';
  const run = spawnSync(
    windows ? 'npm.cmd' : 'npm',
    ['pack', '--dry-run', '--json', '--ignore-scripts'],
    {
      cwd: pkgRoot,
      encoding: 'utf-8',
      shell: windows,
      env: { ...process.env, npm_config_update_notifier: 'false' },
    }
  );
  if (run.error || run.status !== 0) {
    return {
      kind: 'failed',
      reason: `npm pack --dry-run could not list the published files: ${String(run.error ?? run.stderr.trim())}`,
    };
  }
  let output: JsonValue;
  try {
    output = JSON.parse(run.stdout);
  } catch (error) {
    return {
      kind: 'failed',
      reason: `npm pack --dry-run printed no JSON: ${String(error)}`,
    };
  }
  const pack = Array.isArray(output) ? output[0] : undefined;
  const files = isJsonBlock(pack) ? pack.files : undefined;
  if (!Array.isArray(files)) {
    return {
      kind: 'failed',
      reason: 'npm pack --dry-run printed no file list',
    };
  }
  return {
    kind: 'listed',
    files: new Set(
      files.flatMap((file) =>
        isJsonBlock(file) && isJsonString(file.path)
          ? [posixPath(file.path)]
          : []
      )
    ),
  };
}

/** Each `animus` target in the manifest's `exports`, at any depth of
 *  conditions or fallback arrays, with its subpath; and each `animus` value
 *  the check cannot read as a target. */
interface AnimusTargets {
  targets: Array<[subpath: string, target: string]>;
  unreadable: Array<[subpath: string, value: string]>;
}

function animusTargets(manifest: JsonValue): AnimusTargets {
  const targets: Array<[string, string]> = [];
  const unreadable: Array<[string, string]> = [];
  const visit = (subpath: string, value: JsonValue, underAnimus: boolean) => {
    if (isJsonString(value)) {
      if (underAnimus) targets.push([subpath, value]);
    } else if (Array.isArray(value)) {
      for (const entry of value) visit(subpath, entry, underAnimus);
    } else if (isJsonBlock(value)) {
      for (const [key, entry] of Object.entries(value)) {
        visit(subpath, entry, underAnimus || key === KIT_SOURCE_CONDITION);
      }
    } else if (underAnimus && value !== null) {
      unreadable.push([subpath, JSON.stringify(value)]);
    }
  };
  for (const [subpath, value] of exportsSubpaths(manifest)) {
    visit(subpath, value, false);
  }
  return { targets, unreadable };
}

/** Every file in the package outside `node_modules` and `.git`,
 *  package-relative. */
function packageFiles(pkgRoot: string, dir = ''): string[] {
  return readdirSync(join(pkgRoot, dir), { withFileTypes: true }).flatMap(
    (entry) => {
      const path = dir === '' ? entry.name : `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        return entry.name === 'node_modules' || entry.name === '.git'
          ? []
          : packageFiles(pkgRoot, path);
      }
      return entry.isFile() ? [path] : [];
    }
  );
}

/** A `*` target pattern as a matcher of package-relative files. */
function targetPattern(target: string): RegExp {
  const body = posixPath(target)
    .replace(/^\.\//, '')
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.+');
  return new RegExp(`^${body}$`);
}

/**
 * Why the kit at `pkgRoot` would fail an installed consumer: each `animus`
 * source target, at any condition depth or as a pattern, and each file its
 * relative imports reach, must be in the package and among the files `npm
 * pack` publishes, and each bare package import a declared dependency.
 * Each line names the file, the import and the cause; none means the
 * published source is complete.
 */
export function kitPublicationFailures(
  pkgRoot: string,
  engine: ModuleSpecifierReader
): string[] {
  let manifest: JsonValue;
  try {
    manifest = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf-8'));
  } catch (error) {
    return [`package.json: cannot be read: ${String(error)}`];
  }
  const { targets, unreadable } = animusTargets(manifest);
  if (targets.length === 0 && unreadable.length === 0) return [];
  const { moduleSpecifiers } = engine;
  if (moduleSpecifiers === undefined) {
    throw new Error(
      'the native engine does not expose moduleSpecifiers, which the kit publication check needs — rebuild @animus-ui/extract'
    );
  }

  const publication = npmPublishedFiles(pkgRoot);
  if (publication.kind === 'failed') {
    return [`package.json: ${publication.reason}`];
  }
  const published = (packageRelative: string) =>
    publication.files.has(packageRelative);
  const declared = new Set(
    ['dependencies', 'peerDependencies', 'optionalDependencies'].flatMap(
      (field) => {
        const block = isJsonBlock(manifest) ? manifest[field] : undefined;
        return isJsonBlock(block) ? Object.keys(block) : [];
      }
    )
  );
  const ownName =
    isJsonBlock(manifest) && isJsonString(manifest.name) ? manifest.name : null;
  const failures: string[] = [];
  const rel = (file: string) => posixPath(relative(pkgRoot, file));
  const outside = (relPath: string) =>
    relPath.startsWith('../') || isAbsolute(relPath);

  for (const [subpath, value] of unreadable) {
    failures.push(
      `package.json: exports["${subpath}"] has an "animus" value, ${value}, that is no target path`
    );
  }
  const queue: string[] = [];
  const admit = (subpath: string, relPath: string) => {
    if (published(relPath)) {
      queue.push(resolve(pkgRoot, relPath));
    } else {
      failures.push(
        `package.json: the "animus" target of exports["${subpath}"], ${relPath}, is not in the published files`
      );
    }
  };
  let files: string[] | null = null;
  for (const [subpath, target] of targets) {
    const relPath = rel(resolve(pkgRoot, target));
    if (outside(relPath)) {
      failures.push(
        `package.json: the "animus" target of exports["${subpath}"], ${target}, is outside the package`
      );
    } else if (target.includes('*')) {
      // A pattern names every file it matches, and each must publish.
      files ??= packageFiles(pkgRoot);
      const pattern = targetPattern(target);
      const matched = files.filter((file) => pattern.test(file));
      if (matched.length === 0) {
        failures.push(
          `package.json: the "animus" target of exports["${subpath}"], ${target}, matches no file in the package`
        );
      }
      for (const file of matched) admit(subpath, file);
    } else if (!isFile(resolve(pkgRoot, target))) {
      failures.push(
        `package.json: the "animus" target of exports["${subpath}"], ${target}, does not exist in the package`
      );
    } else {
      admit(subpath, relPath);
    }
  }

  const visited = new Set<string>();
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (visited.has(file)) continue;
    visited.add(file);
    const specifiers =
      parseInternalWire<{ files: Record<string, string[]> }>(
        moduleSpecifiers(
          JSON.stringify([{ path: file, source: readFileSync(file, 'utf-8') }])
        ),
        'moduleSpecifiers'
      ).files[file] ?? [];
    for (const specifier of specifiers) {
      if (specifier.startsWith('.')) {
        const target = relativeSourceCandidates(file, specifier).find(isFile);
        if (target === undefined) {
          failures.push(
            `${rel(file)}: import '${specifier}' resolves to no file in the package`
          );
        } else if (outside(rel(target))) {
          failures.push(
            `${rel(file)}: import '${specifier}' resolves to ${rel(target)}, outside the package`
          );
        } else if (!published(rel(target))) {
          failures.push(
            `${rel(file)}: import '${specifier}' resolves to ${rel(target)}, which is not in the published files`
          );
        } else if (CODE_EXTENSIONS.has(extname(target))) {
          queue.push(target);
        }
        continue;
      }
      if (specifier.startsWith('/') || /^[a-z][\w+.-]*:/i.test(specifier)) {
        if (!isBuiltin(specifier)) {
          failures.push(
            `${rel(file)}: import '${specifier}' is not a package or relative import, so an installed consumer cannot resolve it`
          );
        }
        continue;
      }
      const name = bareSpecifierPackageName(specifier);
      if (isBuiltin(name) || name === ownName || declared.has(name)) continue;
      failures.push(
        `${rel(file)}: import '${specifier}' names the package ${name}, which package.json does not declare in dependencies, peerDependencies or optionalDependencies`
      );
    }
  }
  return failures;
}
