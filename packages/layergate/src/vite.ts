/**
 * The Vite adapter. layergate owns the load of each selected stylesheet:
 * the declared sheets, which `virtual:layergate` (or a host's own
 * stylesheet, `declaredBy`) delivers as one finished stylesheet, and, opted
 * in, the `.css` a JS module imports from another package, which loads as
 * `<realpath>?layergate`. Each finished stylesheet has no local `@import`
 * left, and Vite's own CSS pipeline then processes it once: PostCSS,
 * minification, injection or extraction. A JS module's import of an owned
 * sheet reaches it through a proxy that imports the declared sheets first,
 * so they keep their order wherever the app imports an owned sheet first.
 * A stylesheet Vite loads itself that is owned, or reaches an owned file,
 * is finished in `transform`. CSS Modules and special requests (`?inline`,
 * `?url`, `?raw`) stay Vite's.
 */
import { readFileSync, realpathSync, watch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import {
  createIdResolver,
  isCSSRequest,
  isFileLoadingAllowed,
  normalizePath,
} from 'vite';

import { compileUnit } from './compile';
import { resolvePlan } from './plan';
import { readSheet } from './sheet';

import type {
  CompiledUnit,
  CompileOptions,
  LayergateDiagnostic,
  ParsedSheet,
} from './compile';
import type { LayergateOptions } from './plan';
import type { FSWatcher } from 'node:fs';
import type {
  EnvironmentModuleNode,
  Plugin,
  Rolldown,
  ViteDevServer,
} from 'vite';

export type { LayergateOptions } from './plan';

export interface LayergateViteOptions extends LayergateOptions {
  /** The module that delivers the declared sheets; an owned stylesheet a
   *  JS module imports loads it first. Default `virtual:layergate`. A host
   *  that delivers them at the head of its own stylesheet
   *  (`stylesheetHead`) names that stylesheet. */
  declaredBy?: string;
}

const OWNED = '?layergate';
const ENTRY_ID = 'virtual:layergate';
/** `virtual:layergate` is a stylesheet: the declared sheets, finished. */
const RESOLVED_ENTRY = `\0${ENTRY_ID}.css`;
/** A JS module's import of an owned sheet: the declared sheets, then it.
 *  Its id names the file encoded and ends in `.js`, so Vite never takes it
 *  for a stylesheet. */
const PROXY = '\0layergate-proxy:';
const proxyId = (file: string) => `${PROXY}${encodeURIComponent(file)}.js`;
const proxiedFile = (id: string) =>
  decodeURIComponent(id.slice(PROXY.length, -'.js'.length));

const PLAIN_CSS = /\.css$/;
const MODULE_CSS = /\.module\.css$/;

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

/** A path through symlinks, with forward slashes. */
function real(path: string): string {
  try {
    return normalizePath(realpathSync(path));
  } catch {
    return normalizePath(path);
  }
}

/** The file a resolved id names, through symlinks, with forward slashes. */
const fileOf = (id: string) => real(id.split('?')[0]!);

function format(diagnostic: LayergateDiagnostic): string {
  const where = diagnostic.file
    ? `${diagnostic.file}${diagnostic.line ? `:${diagnostic.line}:${diagnostic.column}` : ''}: `
    : '';
  return `[layergate] ${where}${diagnostic.message} [${diagnostic.code}]`;
}

export function layergate(options: LayergateViteOptions = {}) {
  const plan = resolvePlan(options);
  const declaredBy = options.declaredBy ?? ENTRY_ID;
  let root = process.cwd();
  let app: PackageInfo | null = null;
  const packages = new Map<string, PackageInfo | null>();
  /** `@import` inside an owned sheet resolves as Vite resolves a CSS
   *  import: the `style` field and condition, CSS files only. */
  let resolveCss: ReturnType<typeof createIdResolver> | undefined;
  /** Declared sheets, in order. */
  let declared: string[] = [];
  let optedOut = new Set<string>();
  /** Each owned id → the files its finished stylesheet read, and each file
   *  → the owned ids that read it. */
  const filesByUnit = new Map<string, Set<string>>();
  const unitsByFile = new Map<string, Set<string>>();
  /** Parsed files, kept until they change. */
  const parsed = new Map<string, ParsedSheet>();
  /** Each module's finished declared head, kept until a file it read
   *  changes. */
  const heads = new Map<string, string>();
  /** Whether a stylesheet Vite loads itself reaches an owned file, kept
   *  until any file changes. */
  const reaches = new Map<string, boolean>();
  let server: ViteDevServer | undefined;

  /** Vite's watcher ignores node_modules, so an owned file there is
   *  watched here through its directory, which sees edits, atomic saves,
   *  deletion and creation alike, and its change handed to Vite's HMR. */
  const watchers = new Map<string, FSWatcher>();
  const unwatch = (file: string) => {
    watchers.get(file)?.close();
    watchers.delete(file);
  };
  const watchInstalled = (file: string) => {
    if (!server || watchers.has(file) || !file.includes('/node_modules/'))
      return;
    try {
      watchers.set(
        file,
        watch(dirname(file), (_event, name) => {
          if (name === basename(file)) server?.watcher.emit('change', file);
        })
      );
    } catch {
      // A directory that vanished has nothing to report.
    }
  };

  /** Records the files `id`'s finished stylesheet read, forgetting and
   *  unwatching what it no longer reads. */
  const reconcile = (id: string, files: readonly string[]) => {
    const current = new Set(files);
    for (const file of filesByUnit.get(id) ?? []) {
      if (current.has(file)) continue;
      const units = unitsByFile.get(file);
      units?.delete(id);
      if (units?.size === 0) {
        unitsByFile.delete(file);
        parsed.delete(file);
        unwatch(file);
      }
    }
    filesByUnit.set(id, current);
    for (const file of current) {
      let units = unitsByFile.get(file);
      if (!units) unitsByFile.set(file, (units = new Set()));
      units.add(id);
      watchInstalled(file);
    }
  };

  const owns = (file: string): boolean => {
    if (declared.includes(file)) return true;
    if (plan.dependencies === false) return false;
    const owner = packageOf(dirname(file), packages);
    if (!owner || owner.dir === app?.dir) return false;
    return plan.dependencies === true || plan.dependencies.has(owner.name);
  };
  const owning = () => declared.length > 0 || plan.dependencies !== false;

  /** A root-relative URL for `target`, which Vite resolves from any
   *  stylesheet, its own virtual ones too; one outside the root through
   *  Vite's `/@fs/`, which the dev server serves only inside
   *  `server.fs.allow`: the directory of an owned file outside it is
   *  allowed, and nothing more. */
  const rootUrl = (target: string) => {
    const path = relative(real(root), target);
    if (!path.startsWith('..') && !isAbsolute(path))
      return `/${normalizePath(path)}`;
    if (server && !isFileLoadingAllowed(server.config, normalizePath(target))) {
      server.config.server.fs.allow.push(normalizePath(dirname(target)));
    }
    return `/@fs${normalizePath(target)}`;
  };

  /** The file an `@import` in `importer` reaches, as Vite resolves CSS. */
  const resolveImport = async (
    context: Rolldown.PluginContext,
    specifier: string,
    importer: string
  ) => {
    const resolved = await resolveCss?.(
      context.environment,
      specifier,
      importer
    );
    return resolved && PLAIN_CSS.test(fileOf(resolved))
      ? fileOf(resolved)
      : null;
  };

  /** Compiles `roots` with the host's CSS resolver, the plan and the
   *  parsed-file cache. */
  const finish = (
    context: Rolldown.PluginContext,
    roots: string[],
    extra: Partial<CompileOptions> = {}
  ) =>
    compileUnit(roots, {
      layer: plan.layer,
      order: plan.order,
      base: root,
      resolve: (specifier, from) => resolveImport(context, specifier, from),
      read: (file) => readFile(file, 'utf8'),
      quarantined: (file) => !optedOut.has(file),
      owns,
      cache: parsed,
      ...extra,
    });

  /** Reports `unit`'s diagnostics through `context` and records the files
   *  module `id` now reads. */
  const publish = (
    context: Rolldown.PluginContext,
    id: string,
    unit: CompiledUnit
  ) => {
    for (const file of unit.files) context.addWatchFile(file);
    reconcile(id, unit.files);
    for (const diagnostic of unit.diagnostics) {
      const message = format(diagnostic);
      if (diagnostic.severity === 'error') context.error(message);
      else if (diagnostic.severity === 'warning') context.warn(message);
      else context.info(message);
    }
  };

  /** The declared sheets as one finished stylesheet for module `id`, with
   *  root-relative URLs; empty when nothing is declared. */
  const head = async (context: Rolldown.PluginContext, id: string) => {
    if (declared.length === 0) return '';
    const kept = heads.get(id);
    if (kept !== undefined) return kept;
    const unit = await finish(context, declared, { url: rootUrl, map: false });
    publish(context, id, unit);
    heads.set(id, unit.css);
    return unit.css;
  };

  /** Whether the stylesheet `file`, with `code`, reaches an owned file
   *  through its `@import`s, resolved only, never compiled. */
  const reachesOwned = async (
    context: Rolldown.PluginContext,
    file: string,
    code: string,
    seen = new Set<string>()
  ): Promise<boolean> => {
    if (seen.has(file)) return false;
    seen.add(file);
    if (owns(file)) return true;
    for (const statement of readSheet(code).imports) {
      const child = await resolveImport(context, statement.url, file);
      if (!child) continue;
      const text =
        parsed.get(child)?.text ??
        (await readFile(child, 'utf8').catch(() => ''));
      if (await reachesOwned(context, child, text, seen)) return true;
    }
    return false;
  };

  const plugin = {
    name: 'layergate',
    enforce: 'pre',

    configResolved(config) {
      root = config.root;
      // By realpath, as owned files are: a root reached through a symlink
      // (`resolve.preserveSymlinks`) is still the app.
      app = packageOf(real(root), packages);
      resolveCss = createIdResolver(config, {
        extensions: ['.css'],
        mainFields: ['style'],
        conditions: ['style', 'development|production'],
        tryIndex: false,
        preferRelative: true,
      });
    },

    configureServer(devServer) {
      server = devServer;
    },

    buildEnd() {
      for (const file of [...watchers.keys()]) unwatch(file);
    },

    async buildStart() {
      const importer = join(root, 'index.html');
      const resolveAll = async (
        specifiers: readonly string[],
        what: string
      ) => {
        const files: string[] = [];
        for (const specifier of specifiers) {
          const resolved = await this.resolve(specifier, importer, {
            skipSelf: true,
          });
          if (!resolved || resolved.external)
            this.error(
              `[layergate] ${what}: cannot resolve "${specifier}" from ${root}`
            );
          files.push(fileOf(resolved.id));
        }
        return files;
      };
      declared = await resolveAll(plan.sheets, 'sheets');
      const cssModule = declared.find((file) => MODULE_CSS.test(file));
      if (cssModule)
        this.error(
          `[layergate] sheets: ${cssModule} is a CSS Module; layergate does not own CSS Modules yet`
        );
      optedOut = new Set(await resolveAll(plan.optOut, 'optOut'));
      heads.clear();
    },

    async resolveId(source, importer, resolveOptions) {
      if (source === ENTRY_ID) return RESOLVED_ENTRY;
      if (source.endsWith(OWNED) || source.startsWith(PROXY)) return source;
      // Only a plain `.css` request from a JS module, when the plan owns
      // anything: a CSS file's own `@import` is Vite's, or inside a graph
      // layergate already owns.
      if (!owning()) return null;
      if (!importer || importer.startsWith('\0') || isCSSRequest(importer))
        return null;
      if (source.includes('?') || !PLAIN_CSS.test(source)) return null;
      const resolved = await this.resolve(source, importer, {
        ...resolveOptions,
        skipSelf: true,
      });
      if (!resolved || resolved.external) return null;
      const file = fileOf(resolved.id);
      if (!PLAIN_CSS.test(file) || MODULE_CSS.test(file)) return null;
      return owns(file) ? proxyId(file) : null;
    },

    async load(id) {
      if (id === RESOLVED_ENTRY) return head(this, id);
      if (id.startsWith(PROXY)) {
        const file = proxiedFile(id);
        // A declared sheet is in the declared stylesheet already.
        const requests = declared.includes(file)
          ? [declaredBy]
          : [declaredBy, file + OWNED];
        return requests
          .map((request) => `import ${JSON.stringify(request)};`)
          .join('\n');
      }
      if (!id.endsWith(OWNED)) return null;
      const unit = await finish(this, [id.slice(0, -OWNED.length)]);
      publish(this, id, unit);
      return { code: unit.css, map: unit.map };
    },

    // A stylesheet Vite loads itself (an app sheet, or one an HTML link or
    // another sheet's `@import` reaches) never passes through `load`: Vite
    // inlines its `@import`s without asking plugins. One that is owned, or
    // reaches an owned file, is finished here instead, before Vite's CSS
    // pipeline: its own rules stay as they were, and what it reaches of an
    // owned graph is layered.
    async transform(code, id) {
      if (!owning() || id.startsWith('\0') || id.includes('?')) return null;
      if (!PLAIN_CSS.test(id) || MODULE_CSS.test(id)) return null;
      const file = fileOf(id);
      if (!owns(file) && !code.includes('@import')) return null;
      let reached = reaches.get(file);
      if (reached === undefined) {
        reached = await reachesOwned(this, file, code);
        reaches.set(file, reached);
      }
      if (!reached) return null;
      parsed.delete(file);
      const unit = await finish(this, [file], {
        read: (path) => (path === file ? code : readFile(path, 'utf8')),
      });
      publish(this, id, unit);
      return { code: unit.css, map: unit.map };
    },

    hotUpdate({ file, modules }) {
      const changed = normalizePath(file);
      parsed.delete(changed);
      reaches.clear();
      const units = unitsByFile.get(changed);
      if (!units) return;
      const graph = this.environment.moduleGraph;
      const affected: EnvironmentModuleNode[] = [];
      for (const id of units) {
        heads.delete(id);
        const node = graph.getModuleById(id);
        if (!node) continue;
        graph.invalidateModule(node);
        affected.push(node);
      }
      return [...modules, ...affected];
    },
  } satisfies Plugin;

  return Object.assign(plugin, {
    /**
     * The declared sheets as one finished stylesheet, for a host that
     * delivers them at the head of its own stylesheet module `id` (and
     * names it `declaredBy`): URLs are root-relative, and an edit to any
     * file read updates module `id`. Empty when nothing is declared.
     */
    stylesheetHead(this: Rolldown.PluginContext, id: string): Promise<string> {
      return head(this, id);
    },
  });
}

/** The plugin `layergate()` returns, its hooks typed as written. */
export type LayergatePlugin = ReturnType<typeof layergate>;

export default layergate;
