import {
  assembleStylesheet,
  stableStringify,
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
import { systemPropsModuleSource } from './context';
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

export function loadVirtualModule(
  ctx: PluginContext,
  id: string
): string | null {
  const shouldMinify = ctx.options.minify ?? ctx.emissionProd;
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
    // Routed through the shared generator so the HMR change decision reads
    // the exact bytes this hook serves, and the Next plugin cannot drift.
    return systemPropsModuleSource(ctx);
  }

  return null;
}
