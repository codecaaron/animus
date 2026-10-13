import {
  consumerLayers,
  createVendorReporter,
  vendorCoverageNotice,
  vendorCssUnit,
} from '@animus-ui/extract/pipeline';
import { relative } from 'path';
import { isCSSRequest } from 'vite';

import {
  RESOLVED_STYLES_ENTRY_ID,
  VIRTUAL_CSS_ID,
  VIRTUAL_PREFIX,
  VIRTUAL_VENDOR_STYLES_ID,
} from './constants';

import type { PluginContext } from './context';
import type { VendorReporter } from '@animus-ui/extract/pipeline';
import type { HtmlTagDescriptor, Plugin, ResolvedConfig } from 'vite';

/** Every stylesheet language Vite's CSS plugin compiles, as its own
 *  filter matches them. */
const CSS_LANGS =
  /\.(?:css|less|sass|scss|styl|stylus|pcss|postcss|sss)(?:$|\?)/;

/** Requests whose module is not the stylesheet's delivery: Vite answers
 *  them with the file's URL, its raw text or a worker, past its CSS
 *  pipeline. */
const NOT_A_STYLESHEET = /[?&](?:url|raw|worker|sharedworker)\b/;

const VENDOR_LAYER_PLUGIN = 'animus-extract:vendor-layer';

const VENDOR_STYLES_IMPORT = `import '${VIRTUAL_VENDOR_STYLES_ID}';`;

/** The system registers vendor stylesheets for the app to load first. */
function hasDeclaredSheets(ctx: PluginContext): boolean {
  return (ctx.stylesheetPlan?.vendor.length ?? 0) > 0;
}

/** The page loads the registered vendor stylesheets before its own
 *  scripts: one module, which an app import of the same file shares. */
export function vendorStylesTags(ctx: PluginContext): HtmlTagDescriptor[] {
  if (!hasDeclaredSheets(ctx)) return [];
  return [
    {
      tag: 'script',
      attrs: { type: 'module' },
      children: VENDOR_STYLES_IMPORT,
      injectTo: 'head-prepend',
    },
  ];
}

/**
 * A module's import of Animus's stylesheet, when the system registers vendor
 * stylesheets, resolves to an entry loading those first: however the import
 * is written or whichever plugin adds it. The entry's own import is the
 * stylesheet.
 */
export function resolveStylesEntry(
  ctx: PluginContext,
  id: string,
  importer: string | undefined
): string | null {
  if (
    id !== VIRTUAL_CSS_ID ||
    importer === undefined ||
    importer === RESOLVED_STYLES_ENTRY_ID ||
    isCSSRequest(importer) ||
    importer.endsWith('.html') ||
    !hasDeclaredSheets(ctx)
  ) {
    return null;
  }
  return RESOLVED_STYLES_ENTRY_ID;
}

export function loadStylesEntry(id: string): string | null {
  if (id !== RESOLVED_STYLES_ENTRY_ID) return null;
  return `${VENDOR_STYLES_IMPORT}\nimport '${VIRTUAL_CSS_ID}';\n`;
}

/**
 * Runs the vendor layer right after Vite's CSS plugin, wherever the
 * extraction plugin sits or however a config wraps it: in the resolved
 * plugin list, before Vite builds each environment's from it. A config that
 * resolves again (a restarted server) gets it again.
 */
export function insertVendorLayer(
  ctx: PluginContext,
  config: ResolvedConfig
): void {
  // SAFETY: Vite reads each environment's plugins from this list after the
  // configResolved hooks run, so an insertion here joins every environment.
  const plugins = config.plugins as Plugin[];
  if (plugins.some((plugin) => plugin.name === VENDOR_LAYER_PLUGIN)) return;
  const report = createVendorReporter((line) => ctx.warn(line), {
    levels: ctx.options.diagnostics,
    strict: ctx.options.strict,
    info: (line) => ctx.log(line),
  });
  const css = plugins.findIndex((plugin) => plugin.name === 'vite:css');
  if (css === -1) {
    const why = "its CSS plugin (vite:css) is not in the config's plugins";
    report('Vite', why, [vendorCoverageNotice('Vite', why)]);
    return;
  }
  plugins.splice(css + 1, 0, vendorLayerPlugin(ctx, report));
}

/**
 * Wraps every stylesheet Vite compiles that Animus did not produce into the
 * vendor layer: the app's own CSS, a package's, a CSS Module's. It runs
 * after Vite's CSS plugin, on each unit's compiled CSS (imports inlined,
 * module class names minted), and before the unit becomes a style tag or
 * part of a chunk's CSS, so class maps, `?inline` strings and code
 * splitting stay as Vite makes them. A file the system opts out keeps its
 * own cascade position.
 */
function vendorLayerPlugin(ctx: PluginContext, report: VendorReporter): Plugin {
  const consumer = consumerLayers(ctx.options.layers);
  return {
    name: VENDOR_LAYER_PLUGIN,
    transform: {
      filter: { id: CSS_LANGS },
      handler(code, id) {
        if (!isCSSRequest(id) || NOT_A_STYLESHEET.test(id)) return null;
        // Animus's own stylesheets are its virtual modules.
        if (id.startsWith(`\0${VIRTUAL_PREFIX}`)) return null;
        // An environment that emits no CSS drops a stylesheet's text, except
        // the string a `?inline` import exports.
        const env = this.environment?.config;
        if (
          env?.consumer === 'server' &&
          !env.build.emitAssets &&
          !/[?&]inline\b/.test(id)
        ) {
          return null;
        }
        const file = id.split('?')[0]!;
        const shown = ctx.rootDir ? relative(ctx.rootDir, file) : file;
        const delivered = vendorCssUnit(code, file, shown, {
          plan: ctx.stylesheetPlan,
          imports: 'layer',
          consumer,
          report,
        });
        // The layer opens on the body's first line: lines keep their numbers.
        return delivered === code ? null : { code: delivered, map: null };
      },
    },
  };
}
