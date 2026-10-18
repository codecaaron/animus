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
      ? hotSystemPropsSource(ctx.systemPropsModule, systemPropsAdoptable(ctx))
      : ctx.systemPropsModule;
  }

  if (id === RESOLVED_FONT_PRELOADS_ID) return fontPreloadsSource(ctx);

  return null;
}

/** The boundary a generation that may be taken in place carries: the old
 *  generation's callback invalidates a new one that exports its own map. */
const HOT_ACCEPT = `if (import.meta.hot) {
  import.meta.hot.accept((next) => {
    if (next?.systemPropMap !== systemPropMap) {
      import.meta.hot.invalidate('animus: the system props module changed more than adding prop map entries');
    }
  });
}
`;

/**
 * The browser dev server's system-props module: the Session's, accepting a
 * generation that only adds `systemPropMap` entries, as a new utility value
 * does. Without a boundary, an importer path that reaches the entry through
 * no accepting module (a router exporting an object) reloads the page.
 *
 * An added entry is safe to take in place: every mounted component resolves
 * against the one map object on its next render, and one rendered before
 * the entry existed holds a dynamic slot that still applies. So such a
 * generation adds its entries to the map object of the one before it, as it
 * evaluates, and exports that object. Any other generation exports a map of
 * its own, and the old generation's callback invalidates it, so it reaches
 * its importers as it does without the boundary:
 * - one that removes or changes an entry, since a mounted component may
 *   hold that entry's class while nothing renders it again;
 * - one that changes anything but the map (a config, an export).
 * A generation of a project with a class resolver (`asClass`) that has
 * system props is never taken in place, since an updated module may call it
 * as it evaluates, before this module adds the entries it reads. It is
 * served without the boundary, and the hot update marks the module as
 * accepting nothing, so the update reaches its importers at once: a hot
 * step first would re-run updated modules against an outgoing page (a
 * provider re-imported under a consumer that was not). It still records its
 * map, which a later generation that may be taken in place compares with.
 * Server environments and builds are served the Session's module.
 */
function hotSystemPropsSource(source: string, adoptable: boolean): string {
  const span = systemPropMapSpan(source);
  if (span === null) return source;
  const [start, end] = span;
  const signature = contentHash(source.slice(0, start) + source.slice(end));
  return `const __animusSignature = ${JSON.stringify(signature)};
/** The map this generation exports: the one before it, with this one's
 *  added entries, where it adds entries only; else its own. */
function __animusAdopt(incoming) {
  const hot = import.meta.hot;
  if (!hot) return incoming;
  const prior = hot.data.animusSystemProps;
  const own = Object.hasOwn;
  const extendsPrior =
    ${adoptable} &&
    prior?.signature === __animusSignature &&
    Object.entries(prior.map).every(
      ([prop, values]) =>
        own(incoming, prop) &&
        Object.entries(values).every(
          ([key, cls]) => own(incoming[prop], key) && incoming[prop][key] === cls
        )
    );
  const map = extendsPrior ? prior.map : incoming;
  if (extendsPrior) {
    for (const [prop, values] of Object.entries(incoming)) {
      if (!own(map, prop)) map[prop] = {};
      Object.assign(map[prop], values);
    }
  }
  hot.data.animusSystemProps = { signature: __animusSignature, map };
  return map;
}
${source.slice(0, start)}__animusAdopt(${source.slice(start, end)})${source.slice(end)}
${adoptable ? HOT_ACCEPT : ''}`;
}

/** How the system-props generation published last reaches the browser, as
 *  the verbose HMR line names it: in place (it only adds map entries), to
 *  its importers at once (it is served without the boundary), or
 *  invalidated by the client (it removes or changes an entry, or changes
 *  more than the map). */
export function systemPropsDelivery(
  ctx: PluginContext
): 'in place' | 'to its importers' | 'invalidated by the client' {
  if (!systemPropsAdoptable(ctx)) return 'to its importers';
  const prior = ctx.priorSystemPropsModule;
  return prior !== null && mapOnlyGains(prior, ctx.systemPropsModule)
    ? 'in place'
    : 'invalidated by the client';
}

/** Whether `next` differs from `prior` only in map entries it adds: what the
 *  served boundary's adoption checks in the browser. */
function mapOnlyGains(prior: string, next: string): boolean {
  const was = systemPropMapSpan(prior);
  const now = systemPropMapSpan(next);
  if (was === null || now === null) return false;
  const rest = (source: string, [start, end]: [number, number]) =>
    source.slice(0, start) + source.slice(end);
  if (rest(prior, was) !== rest(next, now)) return false;
  // SAFETY: the span is the generator's systemPropMap JSON, prop → value key
  // → class.
  const map = (source: string, [start, end]: [number, number]) =>
    JSON.parse(source.slice(start, end)) as Record<
      string,
      Record<string, string>
    >;
  const before = map(prior, was);
  const after = map(next, now);
  return Object.entries(before).every(
    ([prop, values]) =>
      Object.hasOwn(after, prop) &&
      Object.entries(values).every(
        ([key, cls]) =>
          Object.hasOwn(after[prop], key) && after[prop][key] === cls
      )
  );
}

/** Whether the generation served now may be taken in place: where it may
 *  not, it is served without the boundary, and the update reaches its
 *  importers as it does without one, never through a hot step first. */
export function systemPropsAdoptable(ctx: PluginContext): boolean {
  return !resolvesOutsideRender(ctx);
}

/** Whether a project may resolve system props outside a render: a class
 *  resolver (`asClass`) can be called as its module evaluates. One with no
 *  system props is created without the map (the engine passes it only
 *  where the component's system prop names are not empty), so it reads none
 *  of it. */
function resolvesOutsideRender(ctx: PluginContext): boolean {
  return Object.values(ctx.storedManifest?.components ?? {}).some(
    (component) =>
      component.terminal === 'asClass' && component.system_prop_names.length > 0
  );
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
