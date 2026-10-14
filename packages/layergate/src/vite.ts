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
import { watch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path';
import {
  createIdResolver,
  isCSSRequest,
  isFileLoadingAllowed,
  normalizePath,
  searchForWorkspaceRoot,
} from 'vite';

import { compileUnit } from './compile';
import {
  fileOf,
  formatDiagnostic,
  ownership,
  real,
  resolveEach,
  Units,
} from './host';
import { resolvePlan } from './plan';
import { readSheet } from './sheet';

import type { CompiledUnit, CompileOptions } from './compile';
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

/** The stylesheet a request id names when the request is plain stylesheet
 *  delivery: no query, or only Vite's `direct` (a stylesheet an HTML link
 *  loads in development) and its `t`/`v` cache-busting params. Special
 *  requests (`?inline`, `?url`, `?raw`) and CSS Modules are not. */
function plainCssFile(id: string): string | null {
  const at = id.indexOf('?');
  const path = at === -1 ? id : id.slice(0, at);
  if (!PLAIN_CSS.test(path) || MODULE_CSS.test(path)) return null;
  const params = at === -1 ? [] : id.slice(at + 1).split('&');
  return params.every((param) => param === 'direct' || /^[tv]=/.test(param))
    ? path
    : null;
}

/** Whether `file` lies outside the directory `root`. */
const outside = (root: string, file: string) => {
  const path = relative(root, file);
  return path.startsWith('..') || isAbsolute(path);
};

export function layergate(options: LayergateViteOptions = {}) {
  const plan = resolvePlan(options);
  const declaredBy = options.declaredBy ?? ENTRY_ID;
  let root = process.cwd();
  const owner = ownership(plan);
  const { owns, owning } = owner;
  /** `@import` inside an owned sheet resolves as Vite resolves a CSS
   *  import: the `style` field and condition, CSS files only. */
  let resolveCss: ReturnType<typeof createIdResolver> | undefined;
  /** Declared sheets, in order. */
  let optedOut = new Set<string>();
  /** Parsed files, the files each owned id's finished stylesheet read,
   *  and reach answers. */
  const units = new Units();
  /** Each module's finished declared head, kept until a file it read
   *  changes. */
  const heads = new Map<string, string>();
  let server: ViteDevServer | undefined;

  /** Vite's watcher ignores node_modules, so an owned file there is
   *  watched here through its directory, which sees edits, atomic saves,
   *  deletion and creation alike, and its change handed to Vite's HMR. One
   *  watch serves every owned file of a directory. */
  const directories = new Map<
    string,
    { watcher: FSWatcher; files: Set<string> }
  >();
  const unwatch = (file: string) => {
    const dir = dirname(file);
    const watched = directories.get(dir);
    watched?.files.delete(file);
    if (watched?.files.size === 0) {
      watched.watcher.close();
      directories.delete(dir);
    }
  };
  const watchInstalled = (file: string) => {
    if (!server || !file.includes('/node_modules/')) return;
    const dir = dirname(file);
    const watched = directories.get(dir);
    if (watched) {
      watched.files.add(file);
      return;
    }
    try {
      const files = new Set([file]);
      const watcher = watch(dir, (_event, name) => {
        const changed = name ? `${dir}/${basename(name)}` : null;
        if (changed && files.has(changed))
          server?.watcher.emit('change', changed);
      });
      directories.set(dir, { watcher, files });
    } catch {
      // A directory that vanished has nothing to report.
    }
  };

  /** Records the files `id`'s finished stylesheet read, forgetting and
   *  unwatching what it no longer reads. */
  const reconcile = (id: string, files: readonly string[]) => {
    for (const file of units.record(id, files)) unwatch(file);
    for (const file of files) watchInstalled(file);
  };

  /** A root-relative URL for `target`, which Vite resolves from any
   *  stylesheet, its own virtual ones too; one outside the root through
   *  Vite's `/@fs/`, which the dev server serves only inside
   *  `server.fs.allow`: the directory of an owned file outside it is
   *  allowed, and nothing more. */
  const rootUrl = (target: string) => {
    if (!outside(real(root), target))
      return `/${normalizePath(relative(real(root), target))}`;
    // A declared sheet's own directory is allowed at config time; an asset
    // it references elsewhere is found only now. The dev server reads
    // `server.fs.allow` on each request, so its directory is added here, a
    // dependency on Vite's behaviour it does not document (pinned by the
    // test serving a file outside the root in development).
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
    roots: readonly string[],
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
      cache: units.parsed,
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
      const message = formatDiagnostic(diagnostic);
      if (diagnostic.severity === 'error') context.error(message);
      else if (diagnostic.severity === 'warning') context.warn(message);
      else context.info(message);
    }
  };

  /** The declared sheets as one finished stylesheet for module `id`, with
   *  root-relative URLs; empty when nothing is declared. */
  const head = async (context: Rolldown.PluginContext, id: string) => {
    if (owner.declared.length === 0) return '';
    const kept = heads.get(id);
    if (kept !== undefined) return kept;
    const unit = await finish(context, owner.declared, {
      url: rootUrl,
      map: false,
    });
    publish(context, id, unit);
    heads.set(id, unit.css);
    return unit.css;
  };

  const plugin = {
    name: 'layergate',
    enforce: 'pre',

    // The dev server serves a declared sheet outside the root through
    // `/@fs/`: its directory is allowed here, the documented way, beside
    // the user's own list or, without one, Vite's default workspace root.
    config(userConfig, env) {
      if (env.command !== 'serve') return;
      const base = resolve(userConfig.root ?? process.cwd());
      const require = createRequire(join(base, 'package.json'));
      const dirs: string[] = [];
      for (const specifier of plan.sheets) {
        let file: string;
        try {
          file = real(
            specifier.startsWith('.') || isAbsolute(specifier)
              ? resolve(base, specifier)
              : require.resolve(specifier)
          );
        } catch {
          continue;
        }
        if (outside(real(base), file)) dirs.push(dirname(file));
      }
      if (dirs.length === 0) return;
      const allow = userConfig.server?.fs?.allow
        ? dirs
        : [searchForWorkspaceRoot(base), ...dirs];
      return { server: { fs: { allow } } };
    },

    configResolved(config) {
      root = config.root;
      // By realpath, as owned files are: a root reached through a symlink
      // (`resolve.preserveSymlinks`) is still the app.
      owner.reset(root, []);
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
      for (const { watcher } of directories.values()) watcher.close();
      directories.clear();
    },

    async buildStart() {
      const importer = join(root, 'index.html');
      const resolveOne = async (specifier: string) => {
        const resolved = await this.resolve(specifier, importer, {
          skipSelf: true,
        });
        return resolved && !resolved.external ? fileOf(resolved.id) : null;
      };
      const declared = await resolveEach(
        plan.sheets,
        'sheets',
        root,
        resolveOne
      );
      owner.reset(root, declared);
      const cssModule = declared.find((file) => MODULE_CSS.test(file));
      if (cssModule)
        this.error(
          `[layergate] sheets: ${cssModule} is a CSS Module; layergate does not own CSS Modules yet`
        );
      optedOut = new Set(
        await resolveEach(plan.optOut, 'optOut', root, resolveOne)
      );
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
        const requests = owner.declared.includes(file)
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
      if (!owning() || id.startsWith('\0')) return null;
      const requested = plainCssFile(id);
      if (!requested) return null;
      const file = real(requested);
      const { imports } = readSheet(code);
      if (!owns(file) && imports.length === 0) return null;
      const reached = await units.reaches(file, imports, {
        resolve: (specifier, from) => resolveImport(this, specifier, from),
        read: (path) => readFile(path, 'utf8'),
        owns,
      });
      if (!reached) return null;
      units.parsed.delete(file);
      const unit = await finish(this, [file], {
        read: (path) => (path === file ? code : readFile(path, 'utf8')),
      });
      publish(this, id, unit);
      return { code: unit.css, map: unit.map };
    },

    hotUpdate({ file, modules }) {
      const stale = units.changed(normalizePath(file));
      if (stale.size === 0) return;
      const graph = this.environment.moduleGraph;
      const affected: EnvironmentModuleNode[] = [];
      for (const id of stale) {
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
