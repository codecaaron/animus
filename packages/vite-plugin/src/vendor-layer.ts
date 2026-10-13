import {
  consumerLayers,
  createVendorReporter,
  vendorCssUnit,
} from '@animus-ui/extract/pipeline';
import { relative } from 'path';
import { isCSSRequest } from 'vite';

import { VIRTUAL_PREFIX, VIRTUAL_VENDOR_STYLES_ID } from './constants';
import { afterDirectives } from './transform';

import type { PluginContext } from './context';
import type { HtmlTagDescriptor, Plugin } from 'vite';

/** Every stylesheet language Vite's CSS plugin compiles, as its own
 *  filter matches them. */
const CSS_LANGS =
  /\.(?:css|less|sass|scss|styl|stylus|pcss|postcss|sss)(?:$|\?)/;

/** Requests whose module is not the stylesheet's delivery: Vite answers
 *  them with the file's URL, its raw text or a worker, past its CSS
 *  pipeline. */
const NOT_A_STYLESHEET = /[?&](?:url|raw|worker|sharedworker)\b/;

/** An import of Animus's stylesheet as an app writes it. */
const AUTHORED_STYLESHEET_IMPORT =
  /import\s*['"]virtual:animus\/styles\.css['"]/;

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
 * An app without an index.html loads the registered vendor stylesheets
 * from the module that imports Animus's stylesheet, before anything it
 * imports. The import joins the first line after the directives, so no
 * line moves.
 */
export function withVendorStylesImport(
  ctx: PluginContext,
  source: string,
  transformed: { code: string; map: null } | null
): { code: string; map: null } | null {
  if (!hasDeclaredSheets(ctx) || !AUTHORED_STYLESHEET_IMPORT.test(source)) {
    return transformed;
  }
  return {
    code: afterDirectives(transformed?.code ?? source, VENDOR_STYLES_IMPORT),
    map: null,
  };
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
export function vendorLayerPlugin(ctx: PluginContext): Plugin {
  const report = createVendorReporter((line) => ctx.warn(line), {
    levels: ctx.options.diagnostics,
    strict: ctx.options.strict,
    info: (line) => ctx.log(line),
  });
  const consumer = consumerLayers(ctx.options.layers);
  return {
    name: 'animus-extract:vendor-layer',
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
