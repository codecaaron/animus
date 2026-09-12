import {
  AssertionError,
  assertClassNameFormat,
  assertColorSchemeEmission,
  assertConditionsInsideLayers,
  assertHeadInjectionContract,
  assertKeyframesExtracted,
  assertKeyframesUniqueBodies,
  assertLayerOrder,
  assertNoDevDiagnostics,
  assertNoEmotionImports,
  assertNoLiteralAmpersand,
  assertNoPlaceholders,
  assertSelectorEmitted,
  assertSystemFallbackParity,
  assertSystemSchemeGuard,
  assertVariantDeclarationParity,
  compact,
  findCssFiles,
  findJsFiles,
  layerBlock,
  layerBlockBody,
  readAllConcat,
  systemSchemeVariableSpans,
  writeLaneReceipt,
} from '@animus-ui/assertions';
import { createAppearanceBootstrap } from '@animus-ui/system/bootstrap';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import viteManifest from 'vite/package.json' with { type: 'json' };

import { theme } from '../src/ds';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(APP_ROOT, 'dist');

function selectors(selector: string): Set<string> {
  return new Set(
    selector.split(',').map((part) => {
      const token = compact(part);
      if (/^\*?::?before$/.test(token)) return ':before';
      if (/^\*?::?after$/.test(token)) return ':after';
      return token;
    })
  );
}

function declarations(body: string): Set<string> {
  return new Set(compact(body).split(';'));
}

function assertGlobalBaseline(css: string): void {
  const layer = layerBlockBody(css, 'anm-global') ?? '';
  const bodyDeclarations = new Set<string>();
  let hasReset = false;
  for (const match of layer.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectorSet = selectors(match[1]);
    const ruleDeclarations = declarations(match[2]);
    hasReset ||=
      selectorSet.size === 3 &&
      selectorSet.has('*') &&
      selectorSet.has(':before') &&
      selectorSet.has(':after') &&
      ruleDeclarations.has('box-sizing:border-box');
    if (selectorSet.has('body')) {
      for (const declaration of ruleDeclarations)
        bodyDeclarations.add(declaration);
    }
  }
  if (!hasReset) {
    throw new AssertionError(
      'Expected the global border-box reset inside @layer anm-global'
    );
  }

  const required = [
    'margin:0',
    'background-color:var(--color-background)',
    'color:var(--color-text)',
    'font-family:system-ui,sans-serif',
  ];
  const missing = required.filter((value) => !bodyDeclarations.has(value));
  if (missing.length > 0) {
    throw new AssertionError(
      `Expected the global body baseline inside @layer anm-global; missing: ${missing.join(', ')}`,
      { missing }
    );
  }
}

function emitLaneReceipt(): void {
  // Engine identity is derived by writeLaneReceipt from the fixture config,
  // never spelled here; hostVersion is the installed host, not a range.
  const receipt = writeLaneReceipt(
    resolve(APP_ROOT, '.receipts', 'verify-assert-vite.json'),
    {
      lane: '@animus-ui/vite-app#verify:assert',
      host: 'vite',
      hostVersion: viteManifest.version,
      mode: 'production',
      packageForm: 'workspace',
      engineConfigPath: resolve(APP_ROOT, 'vite.config.ts'),
    }
  );
  console.log(
    `[vite-app:assert] receipt → .receipts/verify-assert-vite.json (engine=${receipt.engineLoaded}, default=${receipt.engineDefault}, override=${receipt.engineOverride})`
  );
}

async function main(): Promise<void> {
  const cssFiles = await findCssFiles(DIST);
  if (cssFiles.length === 0) {
    throw new AssertionError(`No CSS file found under ${DIST}`, { dir: DIST });
  }
  const css = await readAllConcat(cssFiles);

  // The minifier elides the empty anm-global/compounds/custom blocks, and
  // Lightning CSS emits `:root` after the layers, so neither is asserted.
  assertLayerOrder(css, {
    layers: [
      layerBlock('anm-base'),
      layerBlock('anm-variants'),
      layerBlock('anm-states'),
      layerBlock('anm-system'),
    ],
  });

  if (!css.includes(':root')) {
    throw new AssertionError(
      'Expected a :root variable block in the CSS output'
    );
  }

  assertNoPlaceholders(css);
  assertClassNameFormat(css, { prefix: 'animus-' });
  assertGlobalBaseline(css);

  const fontFaceBlock = css.match(/@font-face[^}]*AnimusTestFont[^}]*\}/)?.[0];
  if (!fontFaceBlock) {
    throw new AssertionError(
      'asset() witness: expected the AnimusTestFont @font-face block in the dist CSS'
    );
  }
  const fontUrl = fontFaceBlock.match(/url\((['"]?)([^'")]+)\1\)/)?.[2];
  if (!fontUrl || !/test-font[^'")]*\.woff2$/.test(fontUrl)) {
    throw new AssertionError(
      `asset() witness: expected a bundler-resolved test-font woff2 URL in the @font-face block, got ${fontUrl ?? '<none>'}`,
      { fontFaceBlock }
    );
  }
  await readFile(resolve(DIST, fontUrl.replace(/^\//, ''))).catch(() => {
    throw new AssertionError(
      `asset() witness: the @font-face URL ${fontUrl} does not correspond to an emitted file in dist`,
      { fontUrl }
    );
  });

  // The theme's system-fallback blocks stay unlayered beside `:root` so an
  // explicit mode can override the OS fallback at the same cascade level.
  assertConditionsInsideLayers(css, {
    exemptSpans: systemSchemeVariableSpans(css),
  });

  // A container unit on a strict scale prop must ship verbatim; the minifier
  // may reformat the prelude but not the declaration value.
  if (!css.includes('gap:2cqi') && !css.includes('gap: 2cqi')) {
    throw new AssertionError(
      'container-unit emission pin: expected `gap:2cqi` (verbatim container unit on a strict scale prop) in the dist CSS',
      { probe: 'gap:2cqi' }
    );
  }

  // `positioning` reaches this app only through `.extend(testDs)` — ds.ts
  // does not re-register it — so these declarations prove the merged config.
  for (const probe of [
    ['top:12px', 'top: 12px'],
    ['z-index:10', 'z-index: 10'],
  ] as const) {
    if (!css.includes(probe[0]) && !css.includes(probe[1])) {
      throw new AssertionError(
        `merged-config witness: expected \`${probe[0]}\` (kit-registered positioning prop through .extend()) in the dist CSS`,
        { probe: probe[0] }
      );
    }
  }

  if (
    !css.includes('prefers-color-scheme:dark') &&
    !css.includes('prefers-color-scheme: dark')
  ) {
    throw new AssertionError(
      'built-in condition pin: expected an unregistered `_osDark` block to emit `@media (prefers-color-scheme: dark)` via the default built-in set',
      { probe: 'prefers-color-scheme:dark' }
    );
  }

  assertSystemSchemeGuard(css, { expectSchemes: ['light', 'dark'] });

  assertColorSchemeEmission(css, {
    root: 'dark',
    modes: { dark: 'dark', light: 'light' },
    system: { light: 'light', dark: 'dark' },
  });

  assertSystemFallbackParity(css, {
    mapping: { light: 'light', dark: 'dark' },
  });

  const artifact = createAppearanceBootstrap(theme);
  const indexHtml = await readFile(resolve(DIST, 'index.html'), 'utf8');
  assertHeadInjectionContract(indexHtml, {
    code: artifact.code,
    cspHash: artifact.cspHash,
  });

  // Three blocks: the fixture's `fadeIn` and `pulse` plus the kit's `pulse`,
  // reached through the test-ds package entry.
  assertKeyframesExtracted(css, {
    insideLayer: 'anm-global',
    minBlocks: 3,
    minReferences: 3,
  });

  assertKeyframesUniqueBodies(css);

  assertVariantDeclarationParity(css, {
    components: ['KitSized', 'InlineSized'],
    optionSuffixes: ['size-sm', 'size-md', 'size-lg'],
  });

  // Two matches: the app ActiveItem and the kit GroupItem each emit a
  // `[data-active]` ancestor subject.
  assertSelectorEmitted(css, {
    pattern: /\[data-active="?true"?\]\s*\.animus-[\w-]+/,
    label: 'raw ancestor subject ([data-active="true"] &)',
    minMatches: 2,
  });
  assertSelectorEmitted(css, {
    pattern:
      /\.animus-ActiveItem-[0-9a-f]+\s*\+\s*\.animus-ActiveItem-[0-9a-f]+/,
    label: 'repeated subject (& + &)',
  });
  assertSelectorEmitted(css, {
    pattern: /\.group:hover\s*\.animus-[\w-]+/,
    label: 'registered ancestor alias (_groupHover: .group:hover &)',
  });
  assertSelectorEmitted(css, {
    pattern: /\[data-color-mode="?dark"?\]\s*\.animus-[\w-]+/,
    label: 'registered ancestor alias (_dark: [data-color-mode="dark"] &)',
  });

  assertNoLiteralAmpersand(css);

  const jsFiles = await findJsFiles(DIST);
  const jsSources: string[] = [];
  for (const jsFile of jsFiles) {
    const js = await readFile(jsFile, 'utf8');
    jsSources.push(js);
    assertNoEmotionImports(js);

    for (const identifier of [
      'createAppearanceBootstrap',
      'animus:appearance',
    ]) {
      const offset = js.indexOf(identifier);
      if (offset !== -1) {
        throw new AssertionError(
          `bootstrap entry-point isolation: client bundle ${jsFile} contains '${identifier}' at offset ${offset}`,
          { jsFile, identifier, offset }
        );
      }
    }

    assertNoDevDiagnostics(js);
  }

  // A missed transform still emits CSS while the component renders with an
  // empty className, so every emitted class must be referenced from a bundle.
  const cardClasses = new Set(css.match(/animus-Card-[0-9a-f]+/g) ?? []);
  if (cardClasses.size < 2) {
    throw new AssertionError(
      `root-import witness: expected the app Card AND the test-ds Card to emit classes, found: ${[...cardClasses].join(', ') || '<none>'}`,
      { cardClasses: [...cardClasses] }
    );
  }
  for (const cardClass of cardClasses) {
    if (!jsSources.some((source) => source.includes(cardClass))) {
      throw new AssertionError(
        `root-import witness: class ${cardClass} is emitted in CSS but referenced by no JS bundle — a Card import bypassed the transform (package-root src redirect)`,
        { cardClass }
      );
    }
  }

  console.log(
    `[vite-app:assert] ${cssFiles.length} CSS file(s), ${jsFiles.length} JS file(s) validated — all assertions passed`
  );

  emitLaneReceipt();
}

main().catch((err) => {
  if (err instanceof AssertionError) {
    console.error(`[vite-app:assert] FAIL: ${err.message}`);
    if (err.details) {
      console.error('  details:', JSON.stringify(err.details, null, 2));
    }
  } else {
    console.error('[vite-app:assert] unexpected error:', err);
  }
  process.exit(1);
});
