import {
  assembleStylesheet,
  contentHash,
  reportSurvivingAssetPlaceholders,
  systemPropMapSpan,
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
    targets: ctx.lightning?.targets ?? {},
    features: ctx.lightning?.features,
    keepDirSelector: ctx.options.keepDirSelector,
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
  // Only a build's minification lowers again.
  if (ctx.isProd && !ctx.servedDirSelector) {
    ctx.servedDirSelector = processedBody.includes(':dir(');
  }
  return checked(ctx, [variables, processedBody].filter(Boolean).join('\n'));
}

export function loadVirtualModule(
  ctx: PluginContext,
  id: string,
  environmentName?: string,
  hotClient = false
): string | null {
  // A split build's pages link the slices where this module's CSS lands.
  if (id === RESOLVED_CSS_ID) {
    return ctx.splitsStylesheet
      ? SPLIT_STYLESHEET_MARKER
      : stylesheetSource(ctx);
  }

  if (id === RESOLVED_COMPONENTS_ID) {
    const componentCss = ctx.resolvedComponentCss;
    if (environmentName !== undefined) {
      ctx.servedComponentCss.set(environmentName, componentCss);
    }
    const strippedCss = stripLeadingLayerDeclaration(componentCss);
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
    // The Session's module, built where every host's are: the HMR change
    // decision compares its exact bytes, which decide what is served here.
    return hotClient
      ? hotSystemPropsSource(ctx.systemPropsModule)
      : ctx.systemPropsModule;
  }

  if (id === RESOLVED_FONT_PRELOADS_ID) return fontPreloadsSource(ctx);

  return null;
}

/**
 * The browser dev server's system-props module: the Session's, accepting a
 * generation that changes only `systemPropMap`, as a new utility value does.
 * Without a boundary, an importer path that reaches the entry through no
 * accepting module (a router exporting an object) reloads the page.
 *
 * A generation whose module differs only in the map exports the map object
 * of the one before it, whose callback then replaces its entries in place,
 * the per-prop objects too: the component constructors and class resolvers
 * already running hold that object. A generation that changes anything else
 * (a config, an export) has another signature, exports its own map, and is
 * invalidated before any shared object changes, so it reaches its importers
 * as it does without the boundary. Server environments and builds are
 * served the Session's module.
 */
function hotSystemPropsSource(source: string): string {
  const span = systemPropMapSpan(source);
  if (span === null) return source;
  const [start, end] = span;
  const signature = contentHash(source.slice(0, start) + source.slice(end));
  return `const __animusSignature = ${JSON.stringify(signature)};
/** The map this generation exports: the one before it where only the map
 *  changed, so its callback can replace the entries in place. */
function __animusAdopt(incoming) {
  const hot = import.meta.hot;
  if (!hot) return incoming;
  const prior = hot.data.animusSystemProps;
  const map = prior?.signature === __animusSignature ? prior.map : incoming;
  hot.data.animusSystemProps = { signature: __animusSignature, map, incoming };
  return map;
}
${source.slice(0, start)}__animusAdopt(${source.slice(start, end)})${source.slice(end)}
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    const next = import.meta.hot.data.animusSystemProps;
    if (next.signature !== __animusSignature) {
      import.meta.hot.invalidate('animus: the system props module changed more than its prop map');
      return;
    }
    const own = Object.hasOwn;
    for (const prop of Object.keys(systemPropMap)) {
      if (!own(next.incoming, prop)) delete systemPropMap[prop];
    }
    for (const [prop, values] of Object.entries(next.incoming)) {
      const held = systemPropMap[prop];
      if (held === undefined) {
        systemPropMap[prop] = values;
        continue;
      }
      for (const key of Object.keys(held)) {
        if (!own(values, key)) delete held[key];
      }
      Object.assign(held, values);
    }
  });
}
`;
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
