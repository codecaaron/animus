import { readFileSync, statSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { extname, join, relative, sep } from 'node:path';

import { globToRegExp } from './core-options';
import {
  bareSpecifierPackageName,
  readKitSourceCondition,
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

/** Files npm publishes whatever `files` lists. */
const ALWAYS_PUBLISHED =
  /^(?:package\.json|readme(?:\.[^/]*)?|licen[cs]e(?:\.[^/]*)?|copying(?:\.[^/]*)?)$/i;

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

const posixPath = (path: string) => path.split(sep).join('/');

/**
 * Whether npm publishes a package-relative file, from the manifest's `files`
 * list: an exact file, a directory and everything under it, or a glob, with
 * `!` entries excluding. Without a `files` list, npm publishes every file;
 * `.npmignore` and `.gitignore` are not read here.
 */
export function publishedFiles(
  manifest: JsonValue
): (packageRelative: string) => boolean {
  const files =
    isJsonBlock(manifest) && Array.isArray(manifest.files)
      ? manifest.files.filter(isJsonString)
      : null;
  const main =
    isJsonBlock(manifest) && isJsonString(manifest.main)
      ? posixPath(manifest.main).replace(/^\.\//, '')
      : null;
  const entries = (files ?? []).map((entry) => {
    const negated = entry.startsWith('!');
    const pattern = posixPath(negated ? entry.slice(1) : entry)
      .replace(/^\.\//, '')
      .replace(/\/+$/, '');
    return { negated, pattern, glob: globToRegExp(pattern) };
  });
  const matches = (path: string, pattern: string, glob: RegExp) => {
    const segments = path.split('/');
    // A match on the file, or on a directory above it, publishes the file.
    return segments.some((_, index) => {
      const prefix = segments.slice(0, index + 1).join('/');
      return prefix === pattern || glob.test(prefix);
    });
  };
  return (packageRelative) => {
    const path = posixPath(packageRelative);
    if (path.split('/').includes('node_modules')) return false;
    if (ALWAYS_PUBLISHED.test(path) || path === main) return true;
    if (files === null) return true;
    let published = false;
    for (const { negated, pattern, glob } of entries) {
      if (matches(path, pattern, glob)) published = !negated;
    }
    return published;
  };
}

/**
 * Why the kit at `pkgRoot` would fail an installed consumer: each `animus`
 * source target, and each file its relative imports reach, must be among
 * the published files, and each bare package import a declared dependency.
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
  const condition = readKitSourceCondition(pkgRoot);
  if (condition === null) return [];
  const { moduleSpecifiers } = engine;
  if (moduleSpecifiers === undefined) {
    throw new Error(
      'the native engine does not expose moduleSpecifiers, which the kit publication check needs — rebuild @animus-ui/extract'
    );
  }

  const published = publishedFiles(manifest);
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

  for (const [subpath, target] of condition.invalid) {
    failures.push(
      `package.json: the "animus" target of exports["${subpath}"], ${target}, does not exist in the package`
    );
  }
  const queue: string[] = [];
  for (const [subpath, file] of condition.entries) {
    if (published(rel(file))) {
      queue.push(file);
    } else {
      failures.push(
        `package.json: the "animus" target of exports["${subpath}"], ${rel(file)}, is not in the published files`
      );
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
