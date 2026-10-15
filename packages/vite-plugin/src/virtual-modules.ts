import {
  assembleStylesheet,
  reportSurvivingAssetPlaceholders,
  stableStringify,
  stripLeadingLayerDeclaration,
} from '@animus-ui/extract/pipeline';
import { createHash } from 'crypto';

import {
  RESOLVED_BRIDGE_ID,
  RESOLVED_COMPONENTS_ID,
  RESOLVED_CSS_ID,
  RESOLVED_FONT_PRELOADS_ID,
  RESOLVED_SLICE_IDS,
  RESOLVED_SYSTEM_PROPS_ID,
  SPLIT_STYLESHEET_MARKER,
  VIRTUAL_BRIDGE_ID,
  VIRTUAL_COMPONENTS_ID,
  VIRTUAL_CSS_ID,
  VIRTUAL_FONT_PRELOADS_ID,
  VIRTUAL_PREFIX,
  VIRTUAL_SYSTEM_PROPS_ID,
} from './constants';
import { postProcessCss } from './css';

import type { PluginContext } from './context';

/**
 * Keyed on the whole option record: two instances sharing a key means the
 * later `replaceSync` erases the earlier one's component CSS.
 */
function sheetRegistryHash(ctx: PluginContext): string {
  return createHash('md5')
    .update(stableStringify(ctx.options))
    .digest('hex')
    .slice(0, 8);
}

export function resolveVirtualId(
  ctx: PluginContext,
  id: string
): string | { id: string; moduleSideEffects: boolean } | null {
  if (id === VIRTUAL_CSS_ID) return RESOLVED_CSS_ID;
  if (id.startsWith(VIRTUAL_PREFIX) && RESOLVED_SLICE_IDS.has(`\0${id}`)) {
    return `\0${id}`;
  }
  if (id === VIRTUAL_COMPONENTS_ID) return RESOLVED_COMPONENTS_ID;
  if (id === VIRTUAL_BRIDGE_ID) return RESOLVED_BRIDGE_ID;
  if (id === VIRTUAL_SYSTEM_PROPS_ID) return RESOLVED_SYSTEM_PROPS_ID;
  if (id === VIRTUAL_FONT_PRELOADS_ID) return RESOLVED_FONT_PRELOADS_ID;

  // Redirect external DS package imports to their source entry
  // so Vite serves .ts files (transformable) instead of .mjs dist files.
  // A plain path would drop the package's `sideEffects`, so unused code in
  // the entry could no longer tree-shake out.
  const srcEntry = ctx.externalSourceEntries.get(id);
  if (srcEntry) {
    const moduleSideEffects = ctx.externalSourceSideEffects.get(id);
    return moduleSideEffects === undefined
      ? srcEntry
      : { id: srcEntry, moduleSideEffects };
  }

  return null;
}

function lightningOptions(ctx: PluginContext) {
  return {
    minify: ctx.options.minify ?? ctx.emissionProd,
    targets: ctx.lcssTargets,
    warnFn: (msg: string) => ctx.warn(msg),
  };
}

function checked(ctx: PluginContext, css: string): string {
  reportSurvivingAssetPlaceholders(css, {
    strict: ctx.options.strict,
    warn: (message) => ctx.warn(message),
    reportErrors: ctx.reportErrors(),
    prefix: '[animus-extract]',
  });
  return css;
}

/**
 * The stylesheet `virtual:animus/styles.css` serves: the variables, then
 * the post-processed body. In development the component layers arrive
 * through the bridge's sheet instead, unminified.
 */
export function stylesheetSource(ctx: PluginContext): string {
  const bridged = !ctx.isProd && Boolean(ctx.storedManifest);
  const { variables, body } = assembleStylesheet({
    layers: ctx.options.layers,
    variableCss: ctx.variableCss,
    globalCss: ctx.globalCss,
    componentCss: bridged ? undefined : ctx.resolvedComponentCss,
    split: true,
  });
  const lcssOpts = lightningOptions(ctx);
  if (bridged) lcssOpts.minify = false;
  const processedBody = postProcessCss(body, lcssOpts);
  return checked(ctx, [variables, processedBody].filter(Boolean).join('\n'));
}

export function loadVirtualModule(
  ctx: PluginContext,
  id: string
): string | null {
  // A split build's pages link the slices where this module's CSS lands.
  if (id === RESOLVED_CSS_ID) {
    return ctx.splitsStylesheet
      ? SPLIT_STYLESHEET_MARKER
      : stylesheetSource(ctx);
  }

  if (id === RESOLVED_COMPONENTS_ID) {
    const strippedCss = stripLeadingLayerDeclaration(
      ctx.resolvedComponentCss || ''
    );
    const css = checked(
      ctx,
      postProcessCss(strippedCss, {
        ...lightningOptions(ctx),
        minify: false,
      })
    );
    const escaped = css
      .replace(/\\/g, '\\\\')
      .replace(/`/g, '\\`')
      .replace(/\$/g, '\\$');
    return `export default \`${escaped}\`;`;
  }

  if (id === RESOLVED_BRIDGE_ID) {
    // A global reference keeps HMR re-execution from appending a duplicate
    // CSSStyleSheet.
    const sheetHash = sheetRegistryHash(ctx);
    return `
import css from '${VIRTUAL_COMPONENTS_ID}';

const GLOBAL_KEY = '__animus_sheet_${sheetHash}__';
let sheet = globalThis[GLOBAL_KEY] || null;

// Server evaluation is a no-op: only the browser pass owns a document.
if (typeof document !== 'undefined') {
  if (typeof CSSStyleSheet !== 'undefined' && 'adoptedStyleSheets' in document) {
    if (!sheet) {
      sheet = new CSSStyleSheet();
      globalThis[GLOBAL_KEY] = sheet;
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    }
    sheet.replaceSync(css);
  } else {
    let el = document.querySelector('style[data-animus-components="${sheetHash}"]');
    if (!el) {
      el = document.createElement('style');
      el.setAttribute('data-animus-components', '${sheetHash}');
      document.head.appendChild(el);
    }
    el.textContent = css;
  }
}

if (import.meta.hot) {
  import.meta.hot.accept('${VIRTUAL_COMPONENTS_ID}', (newModule) => {
    // The server module runner has a hot channel too, but owns no document.
    if (typeof document === 'undefined') return;
    if (sheet) {
      sheet.replaceSync(newModule.default);
    } else {
      const el = document.querySelector('style[data-animus-components="${sheetHash}"]');
      if (el) el.textContent = newModule.default;
    }
  });
}
`;
  }

  if (id === RESOLVED_SYSTEM_PROPS_ID) {
    // The Session's module: the HMR change decision compares the exact bytes
    // this hook serves, built where every host's are.
    return ctx.systemPropsModule;
  }

  if (id === RESOLVED_FONT_PRELOADS_ID) return fontPreloadsSource(ctx);

  return null;
}

/**
 * The font-preloads module: each preload at the href index.html preloads it.
 * A build's asset placeholder becomes the emitted file's URL here as it does
 * in the page. A build imports a root-relative file Vite serves with `?url`,
 * so Vite applies its `base` here as it does to the page's preload. Not
 * `fontPreloadsModule`, which reads a `./` href against the module.
 */
function fontPreloadsSource(ctx: PluginContext): string {
  const imports: string[] = [];
  const entries = ctx.fontPreloads.map(({ href, ...rest }) => {
    if (!ctx.isProd || !ctx.servesRootRelative(href) || /[?#]/.test(href)) {
      return JSON.stringify({ href, ...rest });
    }
    const name = `href${imports.length}`;
    imports.push(`import ${name} from ${JSON.stringify(`${href}?url`)};\n`);
    return `{ href: ${name}, ...${JSON.stringify(rest)} }`;
  });
  return `${imports.join('')}export default [${entries.join(', ')}];\n`;
}
