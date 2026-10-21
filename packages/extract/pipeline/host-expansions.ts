import { join } from 'node:path';

/** A regular expression literal as written. */
export interface RegexLiteral {
  source: string;
  flags: string;
}

/** A value written statically in an options object, as JSON. */
export type StaticValue =
  | string
  | number
  | boolean
  | null
  | StaticValue[]
  | { [key: string]: StaticValue };

/** A computed load's arguments as written, as the engine's `prepare` lists
 *  them: by `kind`, a specifier's static text, a context, or a glob. */
export type ListedArgs =
  | {
      /** The specifier's static text between its substitutions: one more
       *  than the substitutions. */
      quasis: string[];
      /** Whether the specifier is a template literal; otherwise a string
       *  concatenation. */
      template: boolean;
      /** `import()`'s options object as written (its attributes). */
      options: { [key: string]: StaticValue } | null;
      /** The comments inside the call, delimiters included. */
      comments: string[];
    }
  | {
      dir: string;
      recursive: boolean | null;
      regExp: RegexLiteral | null;
      include: RegexLiteral | null;
      exclude: RegexLiteral | null;
      mode: string | null;
    }
  | {
      patterns: string[];
      options: { [key: string]: StaticValue } | null;
    };

/** A computed load the engine's `prepare` lists (spec §6.3): a load call or
 *  `import()` that names no single specifier. */
export interface ListedLoad {
  /** The importing module, rootDir-relative, as the analysis keys it. */
  importer: string;
  /** The call's byte offset in the importer. */
  start: number;
  kind:
    | 'import'
    | 'require'
    | 'context'
    | 'webpackContext'
    | 'glob'
    | 'globEager';
  /** Null where an argument is not written statically. */
  args: ListedArgs | null;
}

/** The 1-based line of the UTF-8 byte offset `start` in `source`; null
 *  past its end. */
export function lineAtByte(source: Uint8Array, start: number): number | null {
  if (start > source.length) return null;
  let line = 1;
  for (let at = 0; at < start; at++) if (source[at] === 0x0a) line++;
  return line;
}

/** A computed load as a reader finds it: the importer, the line where the
 *  host can read it, and the call as written (`import.meta.glob('./a/*.tsx')`,
 *  `` import(`./pages/${…}.tsx`) ``). */
export function describeLoad(load: ListedLoad, line: number | null): string {
  const at = line === null ? load.importer : `${load.importer}:${line}`;
  const args = load.args;
  const quote = (text: string) => `'${text}'`;
  let call: string;
  if (args === null)
    call = `a ${load.kind} load whose argument is not written out`;
  else if ('patterns' in args) {
    const callee =
      load.kind === 'globEager' ? 'import.meta.globEager' : 'import.meta.glob';
    call = `${callee}(${args.patterns.map(quote).join(', ')})`;
  } else if ('quasis' in args) {
    const specifier = args.template
      ? `\`${args.quasis.join('${…}')}\``
      : args.quasis.map(quote).join(' + … + ');
    call = `${load.kind === 'require' ? 'require' : 'import'}(${specifier})`;
  } else {
    call = `require.context(${quote(args.dir)}${args.recursive === null ? '' : `, ${args.recursive}`}${args.regExp === null ? '' : `, /${args.regExp.source}/${args.regExp.flags}`})`;
  }
  return `${at} ${call}`;
}

/** A file a computed load expands to, rootDir-relative, with the query the
 *  host loads it with (`''`, or `?…`). */
export interface ExpandedPath {
  path: string;
  query: string;
}

/**
 * How a host's bundler expands computed loads (spec §6.3).
 *
 * A load is named by its importer, rootDir-relative exactly as the
 * analysis keys it, and `start`, the UTF-8 byte offset of the call in the
 * source `prepare` read. A host that locates loads with a JavaScript
 * parser's ranges, which count UTF-16 code units, converts them first (a
 * BOM and `// π 😀` put a call at byte 36, UTF-16 index 31).
 */
export interface HostLoadExpander {
  /** Every file the bundler expands `load` to, exactly as it would, each
   *  rootDir-relative exactly as the analysis keys it, with the query the
   *  host loads it with. Undefined where the host's semantics are not
   *  reproduced exactly, so the load keeps its widest reading: when in
   *  doubt, no expansion. */
  expand(
    load: ListedLoad,
    rootDir: string
  ): readonly ExpandedPath[] | undefined;
}

/** One load's expansion, as the engine's `HostExpansion` reads it. */
export interface HostExpansion {
  importer: string;
  start: number;
  closed: boolean;
  files: Array<{
    path: string;
    status: 'analysed' | 'opaque' | 'unanalysed';
  }>;
}

/**
 * The host's expansion of each listed load the expander reproduces, with
 * each file read as the analysis and the host read it: a module the
 * analysis holds, loaded as code without a query; a file the host loads as
 * an opaque value (spec §2.2 A8); otherwise a file the analysis does not
 * read. A query can select other code than the module (a plugin's
 * transform), so a queried file that is not opaque is never the analysed
 * module, and it keeps its query.
 */
export function hostExpansions(
  loads: readonly ListedLoad[],
  rootDir: string,
  analysed: ReadonlySet<string>,
  expander: HostLoadExpander,
  isAsset: ((file: string, query: string) => boolean) | undefined
): HostExpansion[] {
  const expansions: HostExpansion[] = [];
  for (const load of loads) {
    const expanded = expander.expand(load, rootDir);
    if (expanded === undefined) continue;
    const files = new Map<string, HostExpansion['files'][number]>();
    for (const { path, query } of expanded) {
      const opaque = isAsset?.(join(rootDir, path), query) ?? false;
      const status =
        query === '' && analysed.has(path)
          ? 'analysed'
          : opaque
            ? 'opaque'
            : 'unanalysed';
      const key = `${path}${query}`;
      files.set(key, { path: status === 'analysed' ? path : key, status });
    }
    expansions.push({
      importer: load.importer,
      start: load.start,
      closed: true,
      files: [...files.values()],
    });
  }
  return expansions;
}
