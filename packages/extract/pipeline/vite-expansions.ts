import { readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, posix, relative, resolve, sep } from 'node:path';

import type {
  ExpandedPath,
  HostLoadExpander,
  ListedLoad,
  StaticValue,
} from './host-expansions';

/** One glob segment: literal text, a `*` within it, or `**` across
 *  directories. `dotted` where the segment spells a leading dot itself. */
type Segment =
  | { kind: 'globstar' }
  | { kind: 'match'; test: RegExp; dotted: boolean };

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
  return {
    kind: 'match',
    test: new RegExp(`^${source}$`),
    dotted: text.startsWith('.'),
  };
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/**
 * A pattern as Vite resolves it (`toAbsoluteGlob`): relative to the
 * importer's directory, or with `/` to the Vite root. A pattern in another
 * form (an alias, a bare name) or with syntax not read here is undefined.
 */
function resolveGlob(
  pattern: string,
  importerDir: string,
  viteRoot: string
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

/** Whether `names`, a path below a glob's base, matches its segments. A
 *  wildcard never matches a dot-led name unless `dot`. */
function matches(
  segments: readonly Segment[],
  names: readonly string[],
  dot: boolean
): boolean {
  const [segment, ...rest] = segments;
  if (segment === undefined) return names.length === 0;
  if (segment.kind === 'globstar') {
    if (matches(rest, names, dot)) return true;
    const [name, ...more] = names;
    if (name === undefined || (!dot && name.startsWith('.'))) return false;
    return matches(segments, more, dot);
  }
  const [name, ...more] = names;
  if (name === undefined) return false;
  if (!dot && name.startsWith('.') && !segment.dotted) return false;
  return segment.test.test(name) && matches(rest, more, dot);
}

/** A file below a glob's base: the names from the base down, its path
 *  through them, and the real path the bundler loads it by. */
interface WalkedFile {
  names: string[];
  path: string;
  real: string;
}

/** Every file below `dir`, following symbolic links as Vite does, each
 *  directory once by its real path. A read the walk cannot finish throws:
 *  the expansion would not be every file. */
function walk(
  dir: string,
  prefix: readonly string[] = [],
  visited: ReadonlySet<string> = new Set()
): WalkedFile[] {
  const real = realpathSync(dir);
  if (visited.has(real)) return [];
  const inside = new Set(visited).add(real);
  const files: WalkedFile[] = [];
  for (const name of readdirSync(dir)) {
    const path = `${dir}${sep}${name}`;
    const names = [...prefix, name];
    const stat = statSync(path);
    if (stat.isDirectory()) files.push(...walk(path, names, inside));
    else if (stat.isFile())
      files.push({ names, path, real: realpathSync(path) });
  }
  return files;
}

/** The files a set of Vite globs selects: in any affirmed glob and no
 *  negated one, `node_modules` and dot-led names left out unless
 *  `exhaustive`, the importer itself never. */
function expandGlobs(
  globs: readonly ResolvedGlob[],
  importer: string,
  exhaustive: boolean
): string[] {
  const affirmed = globs.filter((glob) => !glob.negated);
  const negated = globs.filter((glob) => glob.negated);
  const inside = (glob: ResolvedGlob, file: string) => {
    const rel = relative(glob.base, file);
    if (isAbsolute(rel) || rel.split(sep)[0] === '..') return false;
    return matches(glob.segments, rel.split(sep), exhaustive);
  };
  const selected = new Set<string>();
  for (const glob of affirmed) {
    for (const { names, path, real } of walk(glob.base)) {
      if (!exhaustive && names.includes('node_modules')) continue;
      if (path === importer || !inside(glob, path)) continue;
      if (negated.some((other) => inside(other, path))) continue;
      selected.add(real);
    }
  }
  return [...selected].sort();
}

/** The queries a glob's `query` option is read as: Vite's opaque ones,
 *  with or without the `?` it adds. */
const GLOB_QUERIES = new Map<StaticValue | undefined, string>([
  [undefined, ''],
  ['raw', '?raw'],
  ['?raw', '?raw'],
  ['url', '?url'],
  ['?url', '?url'],
]);

/** The boolean an option is written as; absent, `false`. */
const GLOB_FLAGS = new Map<StaticValue | undefined, boolean>([
  [undefined, false],
  [true, true],
  [false, false],
]);

/** A glob's options as Vite reads them (`parseGlobOptions`): the query each
 *  file is imported with and whether the glob is exhaustive. `import`
 *  selects an export, not files. Undefined for an option set not
 *  reproduced here: another query, `base`, `caseSensitive`, or the
 *  deprecated `as`, which a Vite 8 build does not apply as a query. */
function globOptions(
  options: { [key: string]: StaticValue } | null
): { query: string; exhaustive: boolean } | undefined {
  if (options === null) return { query: '', exhaustive: false };
  for (const key of Object.keys(options)) {
    if (!['eager', 'import', 'exhaustive', 'query'].includes(key)) {
      return undefined;
    }
  }
  const query = GLOB_QUERIES.get(options.query);
  const exhaustive = GLOB_FLAGS.get(options.exhaustive);
  if (query === undefined || exhaustive === undefined) return undefined;
  if (!GLOB_FLAGS.has(options.eager)) return undefined;
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

/**
 * How a bundled Vite environment (Vite 8, rolldown's native glob and
 * dynamic-import-vars plugins) expands computed loads (spec §6.3):
 * `import.meta.glob` and a variable `import()`. `importVars` is false where
 * the project's `build.dynamicImportVarsOptions` differ from Vite's
 * default, which transforms every importer outside `node_modules`.
 * Anything this does not reproduce exactly lists no expansion.
 */
export function viteLoadExpander(
  viteRoot: string,
  importVars: boolean
): HostLoadExpander {
  return {
    expand(load: ListedLoad, rootDir: string): ExpandedPath[] | undefined {
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
      let files: string[];
      let realRoot: string;
      try {
        files = expandGlobs(globs, importer, exhaustive);
        realRoot = realpathSync(rootDir);
      } catch {
        // An unreadable directory, or a link that cannot be followed.
        return undefined;
      }
      // Each file by the real path the bundler loads it by.
      return files.map((file) => ({
        path: relative(realRoot, file).split(sep).join(posix.sep),
        query,
      }));
    },
  };
}

/** A Vite alias as its resolved configuration holds it. */
interface ViteAlias {
  find: string | RegExp;
}

/** One resolved Vite environment, as the expander reads it. */
interface ViteEnvironmentReading {
  isBundled?: boolean;
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

/** The aliases Vite adds to every configuration (`clientAlias`), which
 *  name only its own `@vite/` modules. */
const VITE_CLIENT_ALIASES = new Set([
  '^\\/?@vite\\/env',
  '^\\/?@vite\\/client',
]);

/** Whether an alias could rewrite a relative or root specifier, which the
 *  expander reads without the resolver: a string from `.` or `/`, or a
 *  RegExp other than Vite's own client aliases. */
function aliasesRelative(aliases: readonly ViteAlias[] | undefined): boolean {
  return (aliases ?? []).some(({ find }) =>
    find instanceof RegExp
      ? !(find.flags === '' && VITE_CLIENT_ALIASES.has(find.source))
      : find.startsWith('.') || find.startsWith('/')
  );
}

/**
 * The expander for a resolved Vite configuration: only where every
 * environment is bundled (Vite 8, rolldown's native plugins; an earlier
 * Vite marks none), and no alias could rewrite a relative or root
 * specifier. A variable `import()` is expanded only where every environment
 * keeps Vite's default dynamic-import-vars options.
 */
export function viteHostExpander(config: {
  root: string;
  resolve?: { alias?: readonly ViteAlias[] };
  environments?: Record<string, ViteEnvironmentReading>;
}): HostLoadExpander | undefined {
  const environments = Object.values(config.environments ?? {});
  if (
    environments.length === 0 ||
    !environments.every((environment) => environment.isBundled === true) ||
    aliasesRelative(config.resolve?.alias)
  ) {
    return undefined;
  }
  return viteLoadExpander(
    config.root,
    environments.every((environment) =>
      defaultImportVars(environment.build?.dynamicImportVarsOptions)
    )
  );
}
