import {
  assembleStylesheet,
  buildSystemPropsModule,
  stripLeadingLayerDeclaration,
} from '@animus-ui/extract/pipeline';
import { createHash } from 'crypto';

import {
  RESOLVED_BRIDGE_ID,
  RESOLVED_COMPONENTS_ID,
  RESOLVED_CSS_ID,
  RESOLVED_SYSTEM_PROPS_ID,
  VIRTUAL_BRIDGE_ID,
  VIRTUAL_COMPONENTS_ID,
  VIRTUAL_CSS_ID,
  VIRTUAL_SYSTEM_PROPS_ID,
} from './constants';
import { postProcessCss } from './css';

import type { PluginContext } from './context';

/** resolveId: map virtual ids and redirect external DS package imports. */
export function resolveVirtualId(
  ctx: PluginContext,
  id: string
): string | null {
  if (id === VIRTUAL_CSS_ID) return RESOLVED_CSS_ID;
  if (id === VIRTUAL_COMPONENTS_ID) return RESOLVED_COMPONENTS_ID;
  if (id === VIRTUAL_BRIDGE_ID) return RESOLVED_BRIDGE_ID;
  if (id === VIRTUAL_SYSTEM_PROPS_ID) return RESOLVED_SYSTEM_PROPS_ID;

  // Redirect external DS package imports to their source entry
  // so Vite serves .ts files (transformable) instead of .mjs dist files
  const srcEntry = ctx.externalSourceEntries.get(id);
  if (srcEntry) return srcEntry;

  return null;
}

/** load: serve the virtual stylesheet, components CSS, HMR bridge, and
 *  system-props modules from manifest-derived state. */
export function loadVirtualModule(
  ctx: PluginContext,
  id: string
): string | null {
  const shouldMinify = ctx.options.minify ?? ctx.isProd;
  const lcssOpts = {
    minify: shouldMinify,
    targets: ctx.lcssTargets,
    warnFn: (msg: string) => ctx.warn(msg),
  };

  if (id === RESOLVED_CSS_ID) {
    if (!ctx.isProd && ctx.storedSheets) {
      const { variables, body } = assembleStylesheet({
        layers: ctx.options.layers,
        variableCss: ctx.system.variableCss,
        globalCss: ctx.globalCss,
        split: true,
      });
      const processedBody = postProcessCss(body, {
        ...lcssOpts,
        minify: false,
      });
      return [variables, processedBody].filter(Boolean).join('\n');
    }
    const { variables, body } = assembleStylesheet({
      layers: ctx.options.layers,
      variableCss: ctx.system.variableCss,
      globalCss: ctx.globalCss,
      componentCss: ctx.resolvedComponentCss,
      split: true,
    });
    const processedBody = postProcessCss(body, lcssOpts);
    return [variables, processedBody].filter(Boolean).join('\n');
  }

  if (id === RESOLVED_COMPONENTS_ID) {
    const strippedCss = stripLeadingLayerDeclaration(
      ctx.resolvedComponentCss || ''
    );
    const css = postProcessCss(strippedCss, {
      ...lcssOpts,
      minify: false,
    });
    const escaped = css
      .replace(/\\/g, '\\\\')
      .replace(/`/g, '\\`')
      .replace(/\$/g, '\\$');
    return `export default \`${escaped}\`;`;
  }

  if (id === RESOLVED_BRIDGE_ID) {
    // HMR bridge: manages adopted stylesheet with replaceSync()
    // Uses a global reference so re-execution (HMR module re-eval) reuses
    // the existing CSSStyleSheet instead of appending duplicates.
    const sheetHash = createHash('md5')
      .update(ctx.options.system)
      .digest('hex')
      .slice(0, 8);
    return `
import css from '${VIRTUAL_COMPONENTS_ID}';

const GLOBAL_KEY = '__animus_sheet_${sheetHash}__';
let sheet = globalThis[GLOBAL_KEY] || null;

if (typeof CSSStyleSheet !== 'undefined' && 'adoptedStyleSheets' in document) {
  if (!sheet) {
    sheet = new CSSStyleSheet();
    globalThis[GLOBAL_KEY] = sheet;
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }
  sheet.replaceSync(css);
} else {
  // Fallback: inject or update <style> tag
  let el = document.querySelector('style[data-animus-components]');
  if (!el) {
    el = document.createElement('style');
    el.setAttribute('data-animus-components', '');
    document.head.appendChild(el);
  }
  el.textContent = css;
}

if (import.meta.hot) {
  import.meta.hot.accept('${VIRTUAL_COMPONENTS_ID}', (newModule) => {
    if (sheet) {
      sheet.replaceSync(newModule.default);
    } else {
      const el = document.querySelector('style[data-animus-components]');
      if (el) el.textContent = newModule.default;
    }
  });
}
`;
  }

  if (id === RESOLVED_SYSTEM_PROPS_ID) {
    // Single shared generator with the Next plugin — the module shape must
    // never drift between the two runtimes.
    return buildSystemPropsModule({
      systemPropMapJson: ctx.storedSystemPropMapJson,
      groupRegistryJson: ctx.system.groupRegistryJson,
      dynamicProps: JSON.parse(ctx.storedDynamicPropsJson),
      transformsSource: ctx.storedTransformsSource,
    });
  }

  return null;
}
