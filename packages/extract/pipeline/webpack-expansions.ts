import { readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, posix, relative, resolve, sep } from 'node:path';

import type {
  ExpandedPath,
  HostLoadExpander,
  ListedLoad,
  RegexLiteral,
} from './host-expansions';

/** What webpack's resolver for one dependency category (`esm`,
 *  `commonjs`) says about a context's alternative requests. */
export interface WebpackResolveReading {
  extensions: readonly string[];
  mainFiles: readonly string[];
  /** Module directory names (a group), or an absolute module directory. */
  modules: ReadonlyArray<string | readonly string[]>;
  fullySpecified: boolean;
  enforceExtension: boolean;
  /** The names of the resolver's `alias` and `fallback` entries, for the
   *  normal and the context resolver: one could redirect a context or one
   *  of its requests. */
  aliasNames: readonly string[];
}

/** One context webpack builds for a load (`ContextModuleFactory`). */
interface Context {
  dir: string;
  recursive: boolean;
  regExp: RegExp;
  include: RegExp | undefined;
  exclude: RegExp | undefined;
  query: string;
  category: 'esm' | 'commonjs';
}

/** Webpack's `quoteMeta`. */
function quoteMeta(text: string): string {
  return text.replace(/[-[\]\\/{}()*+?.^$|]/g, '\\$&');
}

/** A literal as a RegExp, where webpack tests it statelessly: a global or
 *  sticky one carries state between tests, which is not reproduced. */
function regex(literal: RegexLiteral | null): RegExp | undefined | null {
  if (literal === null) return undefined;
  if (/[gy]/.test(literal.flags)) return null;
  try {
    return new RegExp(literal.source, literal.flags);
  } catch {
    return null;
  }
}

/** Webpack's `splitContextFromPrefix`. */
function splitContextFromPrefix(prefix: string): {
  context: string;
  prefix: string;
} {
  const at = prefix.lastIndexOf('/');
  return at >= 0
    ? { context: prefix.slice(0, at), prefix: `.${prefix.slice(at)}` }
    : { context: '.', prefix };
}

/** A context directory webpack resolves relative to the importer; another
 *  form goes through the resolver (aliases, modules), not reproduced. */
function contextDir(importerDir: string, context: string): string | undefined {
  return context === '.' ||
    context.startsWith('./') ||
    context.startsWith('../')
    ? resolve(importerDir, context)
    : undefined;
}

/** The comments that change which files a webpack context holds. */
const SELECTING_COMMENT = /webpack(?:Include|Exclude|Ignore)\b/;

/**
 * The context webpack builds for a template literal or a concatenation
 * (`ContextDependencyHelpers.create`), with the default wrapped-context
 * options (`/.*\/`, recursive): a template's inner text joins the
 * expression pattern; a concatenation keeps its prefix and postfix only.
 */
function specifierContext(
  load: ListedLoad,
  importerDir: string
): Context | undefined {
  const { args } = load;
  if (args === null || !('quasis' in args)) return undefined;
  if (args.options !== null) return undefined;
  if (args.comments.some((comment) => SELECTING_COMMENT.test(comment))) {
    return undefined;
  }
  const { quasis, template } = args;
  if (quasis.length < 2 || (!template && quasis.length > 2)) return undefined;
  const { context, prefix } = splitContextFromPrefix(quasis[0]!);
  const postfixRaw = quasis[quasis.length - 1]!;
  if (postfixRaw.includes('#')) return undefined;
  const at = postfixRaw.indexOf('?');
  const postfix = at === -1 ? postfixRaw : postfixRaw.slice(0, at);
  const query = at === -1 ? '' : postfixRaw.slice(at);
  const inner = template
    ? quasis
        .slice(1, -1)
        .map((quasi) => `${quoteMeta(quasi)}.*`)
        .join('')
    : '';
  const dir = contextDir(importerDir, context);
  if (dir === undefined) return undefined;
  return {
    dir,
    recursive: true,
    regExp: new RegExp(`^${quoteMeta(prefix)}.*${inner}${quoteMeta(postfix)}$`),
    include: undefined,
    exclude: undefined,
    query,
    category: load.kind === 'require' ? 'commonjs' : 'esm',
  };
}

/** `require.context(dir, recursive, regExp, mode)` and
 *  `import.meta.webpackContext(dir, { … })`, with webpack's defaults. */
function directContext(
  load: ListedLoad,
  importerDir: string
): Context | undefined {
  const { args } = load;
  if (args === null || !('dir' in args)) return undefined;
  const regExp = regex(args.regExp);
  const include = regex(args.include);
  const exclude = regex(args.exclude);
  if (regExp === null || include === null || exclude === null) {
    return undefined;
  }
  const dir = contextDir(importerDir, args.dir);
  if (dir === undefined) return undefined;
  return {
    dir,
    recursive: args.recursive ?? true,
    regExp: regExp ?? /^\.\/.*$/,
    include,
    exclude,
    query: '',
    category: load.kind === 'context' ? 'commonjs' : 'esm',
  };
}

/** A group of module directory names, rather than one absolute module
 *  directory. */
function isModuleGroup(
  modules: string | readonly string[]
): modules is readonly string[] {
  return Array.isArray(modules);
}

/** The requests webpack tests a context file's regExp against
 *  (`RequireContextPlugin`'s `alternativeRequests`). */
function alternatives(
  context: string,
  request: string,
  reading: WebpackResolveReading
): string[] {
  let items = [request];
  if (!reading.fullySpecified) {
    const extended: string[] = [];
    for (const item of items) {
      for (const extension of reading.extensions) {
        if (item.endsWith(extension)) {
          extended.push(item.slice(0, -extension.length));
        }
      }
      if (!reading.enforceExtension) extended.push(item);
    }
    items = [];
    for (const item of extended) {
      for (const mainFile of reading.mainFiles) {
        if (item.endsWith(`/${mainFile}`)) {
          items.push(item.slice(0, -mainFile.length));
          items.push(item.slice(0, -mainFile.length - 1));
        }
      }
      items.push(item);
    }
  }
  const requests: string[] = [];
  for (const item of items) {
    let hidden = false;
    for (const modules of reading.modules) {
      if (isModuleGroup(modules)) {
        for (const name of modules) {
          if (item.startsWith(`./${name}/`)) {
            requests.push(item.slice(name.length + 3));
            hidden = true;
          }
        }
      } else {
        const dir = modules.replace(/\\/g, '/');
        const full = context.replace(/\\/g, '/') + item.slice(1);
        if (full.startsWith(dir)) requests.push(full.slice(dir.length + 1));
      }
    }
    if (!hidden) requests.push(item);
  }
  return requests;
}

/** The files a context holds (`resolveDependencies`): below its directory,
 *  dot-led names skipped, `exclude` and `include` tested on each absolute
 *  path, a file kept when any of its alternative requests matches. */
function contextFiles(
  context: Context,
  reading: WebpackResolveReading
): string[] {
  const files: string[] = [];
  // A read the walk cannot finish throws: the expansion would not be every
  // file.
  const visit = (dir: string, visited: ReadonlySet<string>) => {
    const real = realpathSync(dir);
    const names = readdirSync(dir).map((name) => name.normalize('NFC'));
    if (visited.has(real)) return;
    const inside = new Set(visited).add(real);
    for (const name of names) {
      if (name.startsWith('.')) continue;
      const path = `${dir}${sep}${name}`;
      if (context.exclude?.test(path)) continue;
      const stat = statSync(path);
      if (stat.isDirectory()) {
        if (context.recursive) visit(path, inside);
      } else if (
        stat.isFile() &&
        (!context.include || context.include.test(path))
      ) {
        const request = `.${path.slice(context.dir.length).replace(/\\/g, '/')}`;
        const requests = alternatives(context.dir, request, reading);
        // The resolver follows the link: the module is the real file.
        if (requests.some((alternative) => context.regExp.test(alternative))) {
          files.push(realpathSync(path));
        }
      }
    }
  };
  visit(context.dir, new Set());
  return files.sort();
}

/**
 * How a webpack 5 build expands computed loads (spec §6.3): a template or
 * concatenated `import()` or `require()`, `require.context` and
 * `import.meta.webpackContext`, each a context module whose files
 * `ContextModuleFactory` lists. `resolveReading` is the resolver's options
 * for a dependency category; `wrappedDefaults` is false where the project
 * changes `wrappedContextRegExp` or `wrappedContextRecursive`. Anything not
 * reproduced exactly lists no expansion.
 */
export function webpackLoadExpander(
  resolveReading: (
    category: 'esm' | 'commonjs'
  ) => WebpackResolveReading | undefined,
  wrappedDefaults: boolean
): HostLoadExpander {
  return {
    expand(load: ListedLoad, rootDir: string): ExpandedPath[] | undefined {
      const importerDir = dirname(resolve(rootDir, load.importer));
      let context: Context | undefined;
      if (load.kind === 'import' || load.kind === 'require') {
        context = wrappedDefaults
          ? specifierContext(load, importerDir)
          : undefined;
      } else if (load.kind === 'context' || load.kind === 'webpackContext') {
        context = directContext(load, importerDir);
      }
      if (context === undefined) return undefined;
      const reading = resolveReading(context.category);
      if (reading === undefined || reading.aliasNames.some(redirectsRelative)) {
        return undefined;
      }
      let files: string[];
      let realRoot: string;
      try {
        files = contextFiles(context, reading);
        realRoot = realpathSync(rootDir);
      } catch {
        // An unreadable directory, or a link that cannot be followed.
        return undefined;
      }
      return files.map((file) => ({
        path: relative(realRoot, file).split(sep).join(posix.sep),
        query: context.query,
      }));
    },
  };
}

/** Whether a resolver alias or fallback named `name` could redirect a
 *  relative or absolute request, which the expander reads without the
 *  resolver. */
function redirectsRelative(name: string): boolean {
  return name.startsWith('.') || isAbsolute(name);
}

/** A `module.rules` entry, or a placeholder webpack skips (`'...'`, a
 *  falsy value). */
export type WebpackRuleEntry =
  | WebpackRuleReading
  | string
  | false
  | 0
  | null
  | undefined;

/** A webpack `module.rules` entry, as far as the expander reads it. */
export interface WebpackRuleReading {
  resolve?: object;
  parser?: object;
  rules?: ReadonlyArray<WebpackRuleEntry>;
  oneOf?: ReadonlyArray<WebpackRuleEntry>;
}

/** A rule entry, rather than `'...'` or a falsy placeholder. */
function isRule(rule: WebpackRuleEntry): rule is WebpackRuleReading {
  return rule instanceof Object;
}

/** Every rule, nested `rules` and `oneOf` included. */
function everyRule(
  rules: ReadonlyArray<WebpackRuleEntry>
): WebpackRuleReading[] {
  return rules
    .filter(isRule)
    .flatMap((rule) => [
      rule,
      ...everyRule(rule.rules ?? []),
      ...everyRule(rule.oneOf ?? []),
    ]);
}

/**
 * The expander for a webpack 5 compiler: none where a rule carries its own
 * resolve options or context parser options, which the expander does not
 * read. `wrappedDefaults` is false where a parser changes the wrapped
 * context.
 */
export function webpackHostExpander(reading: {
  resolveReading: (
    category: 'esm' | 'commonjs'
  ) => WebpackResolveReading | undefined;
  wrappedDefaults: boolean;
  rules: ReadonlyArray<WebpackRuleEntry>;
}): HostLoadExpander | undefined {
  const rules = everyRule(reading.rules);
  const unread = rules.some(
    (rule) =>
      rule.resolve !== undefined ||
      Object.keys(rule.parser ?? {}).some((key) => key.includes('Context'))
  );
  if (unread) return undefined;
  return webpackLoadExpander(reading.resolveReading, reading.wrappedDefaults);
}
