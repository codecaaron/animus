/**
 * The Vite adapter. layergate owns the load of each selected stylesheet:
 * a declared sheet, or (opted in) a `.css` a JS module imports from another
 * package. Each loads as one id, `<realpath>?layergate`, whatever the
 * spelling that reached it, and its load is the finished stylesheet, with
 * no local `@import` left, which Vite's own CSS pipeline then processes
 * once: PostCSS, minification, injection or extraction. A JS module's
 * import of one reaches it through a proxy that imports the declared
 * sheets first, so they keep their declared order wherever the app
 * imports an owned sheet first. App CSS, CSS Modules and special requests
 * (`?inline`, `?url`, `?raw`) stay Vite's.
 */
import { existsSync, readFileSync, realpathSync, watch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { createIdResolver, isCSSRequest, normalizePath } from 'vite';

import { compileUnit } from './compile';
import { resolvePlan } from './plan';

import type { LayergateDiagnostic, ParsedSheet } from './compile';
import type { LayergateOptions } from './plan';
import type { FSWatcher } from 'node:fs';
import type { EnvironmentModuleNode, Plugin, ViteDevServer } from 'vite';

export type { LayergateOptions } from './plan';

const OWNED = '?layergate';
const ENTRY_ID = 'virtual:layergate';
const ORDER_ID = 'virtual:layergate/order.css';
const RESOLVED_ENTRY = `\0${ENTRY_ID}`;
const RESOLVED_ORDER = `\0${ORDER_ID}`;
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

export function layergate(options: LayergateOptions = {}) {
  const plan = resolvePlan(options);
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
  let server: ViteDevServer | undefined;
  /** Vite's watcher ignores node_modules, so an owned file there is
   *  watched here, its change handed to Vite's own HMR. A deleted file's
   *  directory is watched until the file returns. */
  const watchers = new Map<string, FSWatcher>();
  const unwatch = (file: string) => {
    watchers.get(file)?.close();
    watchers.delete(file);
  };
  const watchInstalled = (file: string) => {
    if (!server || watchers.has(file) || !file.includes('/node_modules/'))
      return;
    try {
      if (existsSync(file)) {
        watchers.set(
          file,
          watch(file, (event) => {
            server?.watcher.emit('change', file);
            // An atomic save or a deletion replaces the watched file.
            if (event === 'rename') {
              unwatch(file);
              watchInstalled(file);
            }
          })
        );
      } else {
        watchers.set(
          file,
          watch(dirname(file), (_event, name) => {
            if (name !== basename(file) || !existsSync(file)) return;
            unwatch(file);
            watchInstalled(file);
            server?.watcher.emit('change', file);
          })
        );
      }
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

  return {
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
    },

    async resolveId(source, importer, resolveOptions) {
      if (source === ENTRY_ID) return RESOLVED_ENTRY;
      if (source === ORDER_ID) return RESOLVED_ORDER;
      if (source.endsWith(OWNED) || source.startsWith(PROXY)) return source;
      // Only a plain `.css` request from a JS module, when the plan owns
      // anything: a CSS file's own `@import` is Vite's, or inside a graph
      // layergate already owns.
      if (declared.length === 0 && plan.dependencies === false) return null;
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
      if (id === RESOLVED_ENTRY) {
        return [ORDER_ID, ...declared.map((file) => file + OWNED)]
          .map((request) => `import ${JSON.stringify(request)};`)
          .join('\n');
      }
      if (id === RESOLVED_ORDER) return `@layer ${plan.order.join(', ')};\n`;
      if (id.startsWith(PROXY)) {
        const request = proxiedFile(id) + OWNED;
        return `import ${JSON.stringify(ENTRY_ID)};\nimport ${JSON.stringify(request)};\n`;
      }
      if (!id.endsWith(OWNED)) return null;
      const environment = this.environment;
      const unit = await compileUnit(id.slice(0, -OWNED.length), {
        layer: plan.layer,
        order: plan.order,
        base: root,
        resolve: async (specifier, from) => {
          const resolved = await resolveCss?.(environment, specifier, from);
          return resolved && PLAIN_CSS.test(fileOf(resolved))
            ? fileOf(resolved)
            : null;
        },
        read: (file) => readFile(file, 'utf8'),
        quarantined: (file) => !optedOut.has(file),
        cache: parsed,
      });
      for (const file of unit.files) this.addWatchFile(file);
      reconcile(id, unit.files);
      for (const diagnostic of unit.diagnostics) {
        const message = format(diagnostic);
        if (diagnostic.severity === 'error') this.error(message);
        else if (diagnostic.severity === 'warning') this.warn(message);
        else this.info(message);
      }
      return { code: unit.css, map: unit.map };
    },

    hotUpdate({ file, modules }) {
      const changed = normalizePath(file);
      parsed.delete(changed);
      const units = unitsByFile.get(changed);
      if (!units) return;
      const graph = this.environment.moduleGraph;
      const affected: EnvironmentModuleNode[] = [];
      for (const id of units) {
        const node = graph.getModuleById(id);
        if (!node) continue;
        graph.invalidateModule(node);
        affected.push(node);
      }
      return [...modules, ...affected];
    },
  } satisfies Plugin;
}

/** The plugin `layergate()` returns, its hooks typed as written. */
export type LayergatePlugin = ReturnType<typeof layergate>;

export default layergate;
