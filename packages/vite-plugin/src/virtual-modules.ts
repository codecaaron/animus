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
 * The identity of the document-side stylesheet this instance owns — the
 * `globalThis` registry entry holding its adopted `CSSStyleSheet`, and the
 * `<style>` element of the fallback branch.
 *
 * Derived from the WHOLE option record rather than an enumerated
 * emission-relevant subset. Every instance replaces its sheet wholesale
 * (`replaceSync`), so two instances sharing a key means the later loader
 * silently erases the earlier one's component CSS — while an enumerated key
 * would have to be revisited by hand every time an option starts influencing
 * the emitted bytes. Over-keying costs a second identical stylesheet;
 * under-keying costs a page its styles. The system path stays part of the
 * material, so instances with different `system` paths still separate
 * (openspec: vite-extraction-plugin, "HMR state namespaced by system path
 * hash").
 *
 * KNOWN LIMIT — this key is the second line of defence, not the first: the
 * virtual module ids (`constants.ts`) are module-level constants shared by
 * every instance, and Vite gives the first `resolveId`/`load` answer for an
 * id to the whole config. Two `animusExtract()` instances in ONE Vite config
 * therefore never reach two different keys — the second instance's modules
 * import the first instance's bridge and CSS. The ids are the plugin's
 * published contract (`virtual:animus/styles.css` is imported by consumer
 * code and emitted into transformed output by the engine), so namespacing
 * them is a breaking change and is not attempted here. The key separates the
 * case that does not go through resolveId: independently built bundles
 * sharing one document (micro-frontends, an embedded widget).
 */
function sheetRegistryHash(ctx: PluginContext): string {
  return createHash('md5')
    .update(stableStringify(ctx.options))
    .digest('hex')
    .slice(0, 8);
}

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
    // HMR bridge: manages adopted stylesheet with replaceSync()
    // Uses a global reference so re-execution (HMR module re-eval) reuses
    // the existing CSSStyleSheet instead of appending duplicates. Both
    // document-side representations carry this instance's own hash — see
    // `sheetRegistryHash`.
    const sheetHash = sheetRegistryHash(ctx);
    return `
import css from '${VIRTUAL_COMPONENTS_ID}';

const GLOBAL_KEY = '__animus_sheet_${sheetHash}__';
let sheet = globalThis[GLOBAL_KEY] || null;

// Server evaluation is a no-op: SSR hosts reach this module through the
// bridge import prepended to transformed component modules, and only the
// browser pass owns a document.
if (typeof document !== 'undefined') {
  if (typeof CSSStyleSheet !== 'undefined' && 'adoptedStyleSheets' in document) {
    if (!sheet) {
      sheet = new CSSStyleSheet();
      globalThis[GLOBAL_KEY] = sheet;
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    }
    sheet.replaceSync(css);
  } else {
    // Fallback: inject or update this instance's own <style> tag
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
    // The server module runner has a hot channel too; only the browser
    // pass owns a document to update.
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
    // Single shared generator with the Next plugin — the module shape must
    // never drift between the two runtimes. The call is routed through
    // `systemPropsModuleSource` so the HMR change decision compares the exact
    // bytes this hook serves.
    return systemPropsModuleSource(ctx);
  }

  return null;
}
