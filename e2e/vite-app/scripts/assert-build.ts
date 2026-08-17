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
  // Engine identity comes from writeLaneReceipt's retirement guard over the
  // fixture config (openspec: retire-extract-v1) — never spelled here.
  //
  // hostVersion from the fixture's installed host, not the manifest range.
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

  // Cascade order — check the @layer BLOCKS present in the output in their
  // cascade-declared order. anm-global / anm-compounds / anm-custom are
  // currently declaration-only (empty blocks elided by the minifier) so they
  // are excluded here.
  //
  // TODO(fix-lightningcss-cascade): re-enable the stricter default order that
  // requires `:root` to precede the first @layer block. Today `:root` trails
  // the layer blocks due to the open Lightning CSS cascade bug.
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

  // asset() delivery witness (standardize-inheritance-and-assets): the
  // package-owned test font declared via
  // `asset('@animus-ui/test-ds/assets/test-font.woff2')` in src/ds.ts must
  // arrive as the bundler-resolved (hashed, base-prefixed) URL inside the
  // @font-face block, with the emitted file present in dist. (Placeholder
  // survival is covered by assertNoPlaceholders above, for every lane.)
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

  // arch-css-structural-gates › "Condition at-rules gated inside layer blocks":
  // every @container / @supports / non-breakpoint @media condition at-rule must
  // nest inside a named @layer block. Runs NON-VACUOUSLY here — the test-ds
  // Card (raw @container/@media/@supports) and the app Card (registered
  // `_motionReduce` alias) both emit condition rules into this dist.
  //
  // The one exemption is the theme's variable-level system fallback blocks
  // (openspec: system-color-scheme): they belong to the UNLAYERED variables
  // part, beside `:root` and the `[data-color-mode]` blocks, so that an
  // explicit mode can override the OS fallback at the same cascade level.
  // `systemSchemeVariableSpans` grants the exemption only to blocks whose every
  // rule is the root guard — a component condition at-rule outside a layer
  // still trips this gate.
  assertConditionsInsideLayers(css, {
    exemptSpans: systemSchemeVariableSpans(css),
  });

  // Container-unit emission pin (container-query-support › "Container-relative
  // units on scale-typed properties"): the test-ds Card authors `gap: '2cqi'`
  // on a strict space-scale prop inside a nested @container block — the unit
  // string must ship verbatim (the resolver emits it; minifiers may reformat
  // the prelude but not the declaration value).
  if (!css.includes('gap:2cqi') && !css.includes('gap: 2cqi')) {
    throw new AssertionError(
      'container-unit emission pin: expected `gap:2cqi` (verbatim container unit on a strict scale prop) in the dist CSS',
      { probe: 'gap:2cqi' }
    );
  }

  // Merged-config extraction witness (rust-system-loader › "Merged
  // configuration is the extraction authority"): App.tsx uses `top={12}` and
  // `zIndex={10}` on Box, and the `positioning` group that registers both
  // props comes ONLY from `.extend(testDs)` — src/ds.ts deliberately does not
  // re-register it. These declarations can reach the dist CSS only through
  // the MERGED configuration, and `top:12px`
  // additionally pins the kit's `size` transform surviving the registry
  // snapshot merge (no serialized round-trip).
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

  // Built-in condition composite witness: the app Card authors
  // `_osDark` WITHOUT registering it — it must resolve through the DEFAULT
  // built-in set across the full registry → manifest → plugin → engine wire.
  if (
    !css.includes('prefers-color-scheme:dark') &&
    !css.includes('prefers-color-scheme: dark')
  ) {
    throw new AssertionError(
      'built-in condition pin: expected an unregistered `_osDark` block to emit `@media (prefers-color-scheme: dark)` via the default built-in set',
      { probe: 'prefers-color-scheme:dark' }
    );
  }

  // ── System color scheme (openspec: system-color-scheme) ─────────────────
  //
  // This lane is the VITE delivery witness: the theme opts in via
  // `systemPreference` + `browserColorScheme` (src/ds.ts) and the plugin
  // injects the bootstrap via the `appearanceBootstrap` option (vite.config.ts).
  //
  // The layer gate above runs non-vacuously in BOTH directions here:
  // `expectSchemes` demands the two guarded theme blocks exist and assign
  // custom properties, while the app Card's unregistered `_osDark` condition
  // puts an UNGUARDED
  // `@media (prefers-color-scheme: dark) { .animus-Card-… { … } }` block in the
  // same sheet — which must not trip the gate. Only ROOT-targeting rules owe
  // the guard.
  assertSystemSchemeGuard(css, { expectSchemes: ['light', 'dark'] });

  // Classification reaches every surface a native control can read: `:root`
  // (initial mode `dark`), each explicit mode block, and each guarded block.
  assertColorSchemeEmission(css, {
    root: 'dark',
    modes: { dark: 'dark', light: 'light' },
    system: { light: 'light', dark: 'dark' },
  });

  // The OS path and the explicit path are the SAME rendering, not two copies
  // kept in sync by hand — declaration lists compare byte-for-byte through
  // Lightning CSS (which injects its `--lightningcss-*` pair into both blocks
  // alike). Also pins `:root` ahead of both fallbacks.
  assertSystemFallbackParity(css, {
    mapping: { light: 'light', dark: 'dark' },
  });

  // No-flash delivery. Regenerating the artifact from the SAME built theme and
  // byte-comparing it against the shipped script proves three things at once:
  // the plugin embedded the code verbatim, generation is deterministic
  // (identical inputs → identical bytes), and a CSP assembled from `cspHash`
  // would authorize exactly this script. Ordering is the actual no-flash
  // contract — the script must precede the plugin's own `@layer` style tag AND
  // the stylesheet link.
  const artifact = createAppearanceBootstrap(theme);
  const indexHtml = await readFile(resolve(DIST, 'index.html'), 'utf8');
  assertHeadInjectionContract(indexHtml, {
    code: artifact.code,
    cspHash: artifact.cspHash,
  });

  // Keyframes extracted through the rollup (Vite) adapter — fixture declares
  // `animations = keyframes({ fadeIn, pulse })` in src/ds.ts, and KitPulse
  // consumes `kitMotion.pulse` from the test-ds package ENTRY; the assertion
  // proves all three blocks land in @layer anm-global, all three
  // animation-name refs resolve to a matching block, and none got px-mangled
  // by unit-fallback.
  assertKeyframesExtracted(css, {
    insideLayer: 'anm-global',
    minBlocks: 3,
    minReferences: 3,
  });

  // Exactly one @keyframes block per unique frame body: the kit collection
  // must emit ONCE — not once via the external-entry scan and again via the
  // consumer reference — and no app body may collide.
  assertKeyframesUniqueBodies(css);

  // Binding-backed vs inline parity (semantic-const-resolution): KitSized
  // consumes the kit's `as const` variant map through a named import;
  // InlineSized authors the identical map inline. Base + every option class
  // must carry byte-equal declaration lists — a mismatch here is STOP
  // evidence, never paper over it.
  assertVariantDeclarationParity(css, {
    components: ['KitSized', 'InlineSized'],
    optionSuffixes: ['size-sm', 'size-md', 'size-lg'],
  });

  // Ancestor/repeated/alias subject witnesses (nested-selector-resolution):
  // the composed class must sit at the SUBJECT position with the ancestor
  // prefix preserved. Two `[data-active]`
  // producers exist (app ActiveItem + kit GroupItem); the alias patterns pin
  // the kit's registered `_groupHover` / `_dark` ancestor aliases arriving
  // through the `.extend(testDs)` registry merge. Patterns tolerate the
  // minifier stripping attribute-value quotes.
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

  // Zero literal `&` in produced CSS.
  assertNoLiteralAmpersand(css);

  const jsFiles = await findJsFiles(DIST);
  const jsSources: string[] = [];
  for (const jsFile of jsFiles) {
    const js = await readFile(jsFile, 'utf8');
    jsSources.push(js);
    assertNoEmotionImports(js);

    // Bootstrap entry-point isolation: the generator lives behind the
    // `@animus-ui/system/bootstrap` subpath and is reached ONLY from
    // vite.config.ts. Neither it nor its storage keys may reach the client
    // bundle — the snippet ships as HTML text, never as application code.
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

    // Production diagnostic elimination — see is-dev.ts for the define/fold
    // story.
    assertNoDevDiagnostics(js);
  }

  // Root-import transform witness (extraction-dx remediation): App.tsx
  // imports the test-ds Card at the PACKAGE ROOT (`from '@animus-ui/test-ds'`)
  // while ds.ts declares the kit at a subpath — the root import must ride the
  // same src redirect. An untransformed dist chain still renders (with
  // className "") while its CSS sits unreferenced in the sheet, so CSS
  // presence alone stays green: every emitted Card class must also be
  // REFERENCED from a JS bundle, and both Cards (app + test-ds) must emit.
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
