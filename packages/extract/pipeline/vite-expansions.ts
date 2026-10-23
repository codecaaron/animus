import { readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, posix, relative, resolve, sep } from 'node:path';

import type {
  ExpandedPath,
  HostLoadExpander,
  ListedLoad,
  StaticValue,
} from './host-expansions';

/** One glob segment: literal text, a `*` within it, or `**` across
 *  directories. As rolldown's `fast-glob` matches them, a wildcard matches a
 *  dot-led name too; the walk leaves those out instead (`expandGlobs`). */
type Segment = { kind: 'globstar' } | { kind: 'match'; test: RegExp };

/** A glob Vite expands, resolved against the directory it starts in. */
interface ResolvedGlob {
  negated: boolean;
  base: string;
  segments: Segment[];
}

/** The glob syntax read here: literal characters, `*` and a whole-segment
 *  `**`, and a `{a,b}` group of literal alternatives. Anything else (`?`,
 *  classes, extglobs, nested groups) is not reproduced. */
const UNREAD_SYNTAX = /[?[\]()!+@\\]/;

function segmentOf(text: string): Segment | undefined {
  if (text === '**') return { kind: 'globstar' };
  if (UNREAD_SYNTAX.test(text) || text.includes('**')) return undefined;
  let source = '';
  for (const part of text.split(/(\{[^{}]*\}|\*)/)) {
    if (part === '*') source += '[^/]*';
    else if (part.startsWith('{') && part.endsWith('}')) {
      const options = part.slice(1, -1).split(',');
      if (options.some((option) => /[{}*]/.test(option))) return undefined;
      source += `(?:${options.map(escape).join('|')})`;
    } else if (/[{}]/.test(part)) return undefined;
    else source += escape(part);
  }
  return { kind: 'match', test: new RegExp(`^${source}$`) };
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/**
 * A pattern as Vite resolves it (`toAbsoluteGlob`): relative to the
 * importer's directory, or with `/` to the Vite root, where it is known. A
 * pattern in another form (an alias, a bare name, `**` from the root) or
 * with syntax not read here is undefined.
 */
function resolveGlob(
  pattern: string,
  importerDir: string,
  viteRoot: string | undefined
): ResolvedGlob | undefined {
  const negated = pattern.startsWith('!');
  const body = negated ? pattern.slice(1) : pattern;
  const start = body.startsWith('/')
    ? viteRoot
    : body.startsWith('./') || body.startsWith('../')
      ? importerDir
      : undefined;
  if (start === undefined) return undefined;
  const parts = body.split('/').filter((part) => part !== '' && part !== '.');
  let base = start;
  let index = 0;
  // Every segment is read, the fixed directories included.
  if (parts.some((part) => part !== '..' && UNREAD_SYNTAX.test(part))) {
    return undefined;
  }
  // The fixed directories before the first glob segment.
  while (index < parts.length - 1 && !/[*{}]/.test(parts[index]!)) {
    base = parts[index] === '..' ? dirname(base) : resolve(base, parts[index]!);
    index += 1;
  }
  const segments: Segment[] = [];
  for (const part of parts.slice(index)) {
    if (part === '..') return undefined;
    const segment = segmentOf(part);
    if (segment === undefined) return undefined;
    segments.push(segment);
  }
  return { negated, base, segments };
}

/** Whether `names`, a path below a glob's base, matches its segments. */
function matches(
  segments: readonly Segment[],
  names: readonly string[]
): boolean {
  const [segment, ...rest] = segments;
  if (segment === undefined) return names.length === 0;
  if (segment.kind === 'globstar') {
    if (matches(rest, names)) return true;
    const [, ...more] = names;
    return names.length > 0 && matches(segments, more);
  }
  const [name, ...more] = names;
  if (name === undefined) return false;
  return segment.test.test(name) && matches(rest, more);
}

/** Every file below `dir`, by its path through the walk, following
 *  symbolic links as Vite does, each directory once by its real path, and
 *  no name `pruned` holds. A read the
 *  walk cannot finish throws: the expansion would not be every file. */
function walk(
  dir: string,
  pruned: (name: string) => boolean,
  visited: ReadonlySet<string> = new Set()
): string[] {
  const real = realpathSync(dir);
  if (visited.has(real)) return [];
  const inside = new Set(visited).add(real);
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    if (pruned(name)) continue;
    const path = `${dir}${sep}${name}`;
    const stat = statSync(path);
    if (stat.isDirectory()) files.push(...walk(path, pruned, inside));
    else if (stat.isFile()) files.push(path);
  }
  return files;
}

/** The deepest directory every one of `dirs` is in. */
function commonDirectory(dirs: readonly string[]): string {
  const [first, ...rest] = dirs.map((dir) => dir.split(sep));
  let length = first!.length;
  for (const parts of rest) {
    let shared = 0;
    while (
      shared < Math.min(length, parts.length) &&
      parts[shared] === first![shared]
    ) {
      shared += 1;
    }
    length = shared;
  }
  return first!.slice(0, length).join(sep) || sep;
}

/** The files a set of Vite globs selects, as rolldown's import-glob plugin
 *  walks them: from the deepest directory every affirmed glob's base is
 *  in, leaving out every dot-led and `node_modules` name below it unless
 *  `exhaustive`; in any affirmed glob and no negated one; the importer
 *  itself never. Each is named by its path through the walk. Undefined
 *  where that directory is the filesystem root, which Vite walks from its
 *  own root instead. */
function expandGlobs(
  globs: readonly ResolvedGlob[],
  importer: string,
  exhaustive: boolean
): string[] | undefined {
  const affirmed = globs.filter((glob) => !glob.negated);
  const negated = globs.filter((glob) => glob.negated);
  const start = commonDirectory(affirmed.map((glob) => glob.base));
  if (dirname(start) === start) return undefined;
  const inside = (glob: ResolvedGlob, file: string) => {
    const rel = relative(glob.base, file);
    if (isAbsolute(rel) || rel.split(sep)[0] === '..') return false;
    return matches(glob.segments, rel.split(sep));
  };
  const pruned = (name: string) =>
    !exhaustive && (name.startsWith('.') || name === 'node_modules');
  return walk(start, pruned).filter(
    (path) =>
      path !== importer &&
      affirmed.some((glob) => inside(glob, path)) &&
      !negated.some((glob) => inside(glob, path))
  );
}

/** The query a glob's `query` option imports each file with, as rolldown
 *  writes it: a string, with the `?` it adds; an object of string, boolean
 *  and null values as `?key=value&…`. Undefined for any other value. */
function globQuery(query: StaticValue | undefined): string | undefined {
  if (query === undefined) return '';
  // A string is the one value its own text spells.
  if (String(query) === query) {
    return query.startsWith('?') ? query : `?${query}`;
  }
  if (!(query instanceof Object) || Array.isArray(query)) return undefined;
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    const written =
      value === null ||
      value === true ||
      value === false ||
      String(value) === value;
    if (!written) return undefined;
    pairs.push(`${key}=${String(value)}`);
  }
  return pairs.length === 0 ? '' : `?${pairs.join('&')}`;
}

/** The boolean an option is written as; absent, `false`. */
const GLOB_FLAGS = new Map<StaticValue | undefined, boolean>([
  [undefined, false],
  [true, true],
  [false, false],
]);

/** A glob's options as Vite reads them (`parseGlobOptions`): the query each
 *  file is imported with and whether the glob is exhaustive. `eager` and
 *  `import` choose how, not which files. Undefined for an option set not
 *  reproduced here: a query of another form, `base`, `caseSensitive`, the
 *  deprecated `as`, which a Vite 8 build does not apply as a query, or any
 *  other key. */
function globOptions(
  options: { [key: string]: StaticValue } | null
): { query: string; exhaustive: boolean } | undefined {
  if (options === null) return { query: '', exhaustive: false };
  for (const key of Object.keys(options)) {
    if (!['eager', 'import', 'exhaustive', 'query'].includes(key)) {
      return undefined;
    }
  }
  const query = globQuery(options.query);
  const exhaustive = GLOB_FLAGS.get(options.exhaustive);
  if (query === undefined || exhaustive === undefined) return undefined;
  return { query, exhaustive };
}

/**
 * The glob a variable `import()` of a template literal becomes under
 * Vite's dynamic-import-vars (`dynamicImportToGlob`): each substitution one
 * `*` within a segment. It must start `./` or `../` and name a file
 * extension in its last static text; Vite leaves any other one, and a
 * concatenation, a runtime import, which it does not expand.
 */
function importVarsGlob(quasis: readonly string[]): string | undefined {
  if (quasis.length < 2) return undefined;
  const head = quasis[0]!;
  if (!head.startsWith('./') && !head.startsWith('../')) return undefined;
  if (quasis.slice(1, -1).some((quasi) => quasi === '')) return undefined;
  if (quasis.some((quasi) => /[*?{}[\]]/.test(quasi))) return undefined;
  const last = quasis[quasis.length - 1]!;
  if (!/\.[a-z0-9]+$/i.test(last) || last.includes('?')) return undefined;
  return quasis.join('*');
}

/** A Vite alias as its resolved configuration holds it. */
interface ViteAlias {
  find: string | RegExp;
}

/** Whether one of `aliases` rewrites a specifier, as Vite's alias plugin
 *  matches one: a string by equality or as a directory prefix, a RegExp by
 *  its test (a `g` or `y` flag keeps no state there). */
function aliasMatcher(
  aliases: readonly ViteAlias[]
): (specifier: string) => boolean {
  const finds = aliases.map(({ find }) =>
    find instanceof RegExp
      ? new RegExp(find.source, find.flags.replace(/[gy]/g, ''))
      : find
  );
  return (specifier) =>
    finds.some((find) =>
      find instanceof RegExp
        ? find.test(specifier)
        : specifier === find || specifier.startsWith(`${find}/`)
    );
}

/**
 * How a bundled Vite environment (Vite 8, rolldown's native glob and
 * dynamic-import-vars plugins) expands computed loads (spec §6.3):
 * `import.meta.glob` and a variable `import()`. `viteRoot` is undefined
 * where the root is not known, which leaves a glob from it unexpanded.
 * `importVars` is false where the project's `build.dynamicImportVarsOptions`
 * differ from Vite's default, which transforms every importer outside
 * `node_modules`. `preserveSymlinks` is the resolver's own: a linked file
 * is then loaded by its link path, and resolves its imports beside the
 * link. Vite aliases no pattern, but imports each file it expands to by
 * its path from the importer (`./a.js`, `../b.js`) and the load's query
 * through `aliases`: a load one of whose files an alias rewrites lists no
 * expansion. Anything this does not reproduce exactly lists none.
 */
export function viteLoadExpander(
  viteRoot: string | undefined,
  importVars: boolean,
  preserveSymlinks = false,
  aliases: readonly ViteAlias[] = []
): HostLoadExpander {
  const rewrites = aliasMatcher(aliases);
  return {
    expand(
      load: ListedLoad,
      rootDir: string,
      realpaths = new Map<string, string>()
    ): ExpandedPath[] | undefined {
      // A path that cannot be followed throws, as `realpathSync` does, and
      // is asked again.
      const real = (path: string): string => {
        let found = realpaths.get(path);
        if (found === undefined) {
          found = realpathSync(path);
          realpaths.set(path, found);
        }
        return found;
      };
      const importer = resolve(rootDir, load.importer);
      const importerDir = dirname(importer);
      let patterns: string[];
      let query = '';
      let exhaustive = false;
      if (load.kind === 'glob' && load.args && 'patterns' in load.args) {
        const read = globOptions(load.args.options);
        if (read === undefined) return undefined;
        ({ query, exhaustive } = read);
        patterns = load.args.patterns;
      } else if (load.kind === 'import' && load.args && 'quasis' in load.args) {
        if (
          !importVars ||
          importer.split(sep).includes('node_modules') ||
          !load.args.template ||
          load.args.options !== null ||
          load.args.comments.some((comment) => comment.includes('@vite-ignore'))
        ) {
          return undefined;
        }
        const glob = importVarsGlob(load.args.quasis);
        if (glob === undefined) return undefined;
        patterns = [glob];
      } else {
        return undefined;
      }
      const globs: ResolvedGlob[] = [];
      for (const pattern of patterns) {
        const glob = resolveGlob(pattern, importerDir, viteRoot);
        if (glob === undefined) return undefined;
        globs.push(glob);
      }
      if (!globs.some((glob) => !glob.negated)) return undefined;
      // Vite imports each file by its path from the importer, `./` added,
      // with the load's query, through the aliases.
      const aliased = (path: string) => {
        const specifier = relative(importerDir, path)
          .split(sep)
          .join(posix.sep);
        return rewrites(
          `${specifier.startsWith('.') ? '' : './'}${specifier}${query}`
        );
      };
      let files: string[];
      let base: string;
      try {
        const walked = expandGlobs(globs, importer, exhaustive);
        if (walked === undefined || walked.some(aliased)) return undefined;
        // Each by the real path the resolver loads it by, or with
        // `preserveSymlinks` by its path through the walk, links kept, as
        // Vite then loads it.
        files = [
          ...new Set(preserveSymlinks ? walked : walked.map(real)),
        ].sort();
        // A walked path runs through the root as the importer is named.
        base = preserveSymlinks ? rootDir : real(rootDir);
      } catch {
        // An unreadable directory, or a link that cannot be followed.
        return undefined;
      }
      return files.map((file) => ({
        path: relative(base, file).split(sep).join(posix.sep),
        query,
      }));
    },
  };
}

/** One resolved Vite environment, as the expander reads it. */
interface ViteEnvironmentReading {
  isBundled?: boolean;
  resolve?: { preserveSymlinks?: boolean };
  build?: {
    dynamicImportVarsOptions?: { include?: unknown; exclude?: unknown };
  };
}

/** Whether `build.dynamicImportVarsOptions` are Vite's default, which
 *  transforms every importer outside `node_modules`. */
function defaultImportVars(
  options: { include?: unknown; exclude?: unknown } | undefined
): boolean {
  const exclude = options?.exclude;
  return (
    options?.include === undefined &&
    Array.isArray(exclude) &&
    exclude.length === 1 &&
    exclude[0] instanceof RegExp &&
    exclude[0].source === 'node_modules' &&
    exclude[0].flags === ''
  );
}

/**
 * The expander for a resolved Vite configuration, reading its aliases:
 * only where every environment is bundled (Vite 8, rolldown's native
 * plugins; an earlier Vite marks none) and resolves links alike
 * (`resolve.preserveSymlinks`).
 * A variable `import()` is expanded only where every environment keeps
 * Vite's default dynamic-import-vars options.
 */
export function viteHostExpander(config: {
  root: string;
  resolve?: { alias?: readonly ViteAlias[]; preserveSymlinks?: boolean };
  environments?: Record<string, ViteEnvironmentReading>;
}): HostLoadExpander | undefined {
  const environments = Object.values(config.environments ?? {});
  const preserved = new Set(
    environments.map(
      (environment) =>
        environment.resolve?.preserveSymlinks ??
        config.resolve?.preserveSymlinks ??
        false
    )
  );
  if (
    environments.length === 0 ||
    !environments.every((environment) => environment.isBundled === true) ||
    preserved.size !== 1
  ) {
    return undefined;
  }
  return viteLoadExpander(
    config.root,
    environments.every((environment) =>
      defaultImportVars(environment.build?.dynamicImportVarsOptions)
    ),
    preserved.has(true),
    config.resolve?.alias
  );
}
