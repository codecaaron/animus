import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

import { PluginContext } from '../src/context';
import { animusExtract } from '../src/index';
import { buildIndexHtmlTags } from '../src/index-html';

import type { HtmlTagDescriptor } from 'vite';

/**
 * Delivery-only bootstrap injection (openspec: system-color-scheme, D6).
 *
 * The plugin embeds a PRE-GENERATED artifact string. It never imports the
 * generator (`@animus-ui/system/bootstrap`), never inspects appearance
 * semantics, and emits nothing at all when the option is absent.
 *
 * Ordering note (read out of the installed vite 8.1.4,
 * `dist/node/chunks/node.js`; cross-checked against 8.0.3 by this increment's
 * audit):
 * - `applyHtmlTransforms` buckets a returned array by `injectTo`, then calls
 *   `injectToHead(html, headPrependTags, true)` ONCE for the whole bucket;
 * - `serializeTags` maps the bucket in ARRAY ORDER, so array order is document
 *   order inside a single returned array;
 * - `head-prepend` lands the bucket immediately after `<head>`, while the
 *   build-html plugin appends its `<link rel="stylesheet">` tags with
 *   `injectToHead(result, assetTags)` (no prepend, i.e. before `</head>`).
 *   Both facts together are why the script precedes every stylesheet
 *   reference in built HTML.
 */

const LAYER_DECLARATION =
  '@layer anm-global, anm-base, anm-variants, anm-compounds, anm-states, anm-system, anm-custom;';

const ARTIFACT = {
  code: '(function(){try{var r=document.documentElement;r.removeAttribute("data-color-mode")}catch(e){}})();',
  cspHash: 'sha256-Zm9vYmFyYmF6',
};

/**
 * The layer-declaration descriptor exactly as the plugin produced it BEFORE
 * this change. G4's parity baseline: with no `appearanceBootstrap` option the
 * handler must still return this and nothing else.
 *
 * Provenance: transcribed from the pre-change `transformIndexHtml` handler at
 * `git show HEAD:packages/vite-plugin/src/index.ts`. The load-bearing pins are
 * `tag` / `attrs` / `injectTo` / array length; `children` is a pass-through
 * identity (whatever `ctx.layerDeclaration` holds), not a frozen string.
 */
const PRE_CHANGE_LAYER_TAG: HtmlTagDescriptor = {
  tag: 'style',
  attrs: { 'data-animus-layers': '' },
  children: LAYER_DECLARATION,
  injectTo: 'head-prepend',
};

/**
 * Production context by default.
 *
 * Every assertion in this file is about BUILT HTML — the bootstrap artifact and
 * the layer declaration are both build-time deliveries, and the exact-array
 * pins below state that an unconfigured build emits nothing of its own. The
 * builder's third branch, the dev-only HMR bridge module script, is therefore
 * out of frame here; it has its own file
 * (`tests/hmr-bridge-injection.test.ts`), which also pins the ordering of all
 * three tags together.
 */
function contextWith(
  overrides: {
    isProd?: boolean;
    appearanceBootstrap?: { code: string; cspHash: string };
    layerDeclaration?: string;
  } = {}
): PluginContext {
  const ctx = new PluginContext({
    system: './ds.ts',
    ...(overrides.appearanceBootstrap
      ? { appearanceBootstrap: overrides.appearanceBootstrap }
      : {}),
  });
  ctx.isProd = overrides.isProd ?? true;
  ctx.layerDeclaration = overrides.layerDeclaration ?? LAYER_DECLARATION;
  return ctx;
}

describe('Vite injection option: opt-in injection', () => {
  test('option present emits the artifact code verbatim in a marked script', () => {
    const tags = buildIndexHtmlTags(
      contextWith({ appearanceBootstrap: ARTIFACT })
    );

    expect(tags).toContainEqual({
      tag: 'script',
      attrs: { 'data-animus-bootstrap': '' },
      children: ARTIFACT.code,
      injectTo: 'head-prepend',
    });
  });

  test('the script precedes the layer-declaration style in the returned array', () => {
    const tags = buildIndexHtmlTags(
      contextWith({ appearanceBootstrap: ARTIFACT })
    );

    const scriptIndex = tags.findIndex((t) => t.tag === 'script');
    const styleIndex = tags.findIndex((t) => t.tag === 'style');

    expect(scriptIndex).toBeGreaterThanOrEqual(0);
    expect(styleIndex).toBeGreaterThanOrEqual(0);
    expect(scriptIndex).toBeLessThan(styleIndex);
    // Every tag rides the same head-prepend bucket, so array order survives
    // into the document (see the ordering note above).
    expect(tags.every((t) => t.injectTo === 'head-prepend')).toBe(true);
  });

  test('injection does not depend on a layer declaration being present', () => {
    const tags = buildIndexHtmlTags(
      contextWith({ appearanceBootstrap: ARTIFACT, layerDeclaration: '' })
    );

    expect(tags).toEqual([
      {
        tag: 'script',
        attrs: { 'data-animus-bootstrap': '' },
        children: ARTIFACT.code,
        injectTo: 'head-prepend',
      },
    ]);
  });

  test('the plugin never reads the artifact beyond `code` (no cspHash leakage)', () => {
    const tags = buildIndexHtmlTags(
      contextWith({ appearanceBootstrap: ARTIFACT })
    );

    expect(JSON.stringify(tags)).not.toContain(ARTIFACT.cspHash);
  });

  test('an empty-code artifact emits no script tag', () => {
    // A caller defect, not a configuration: the guard is symmetric with the
    // layer-declaration branch, so an empty artifact must not leave an inert
    // `<script data-animus-bootstrap></script>` behind.
    const tags = buildIndexHtmlTags(
      contextWith({ appearanceBootstrap: { code: '', cspHash: '' } })
    );

    expect(tags.some((t) => t.tag === 'script')).toBe(false);
    expect(tags).toEqual([PRE_CHANGE_LAYER_TAG]);
    expect(JSON.stringify(tags)).not.toContain('bootstrap');
  });

  test('an empty-code artifact with no layer declaration emits nothing at all', () => {
    const tags = buildIndexHtmlTags(
      contextWith({
        appearanceBootstrap: { code: '', cspHash: '' },
        layerDeclaration: '',
      })
    );

    expect(tags).toEqual([]);
  });
});

/**
 * G3 executable witness — bootstrap entry-point isolation.
 *
 * The literal `rg -n "system/bootstrap"` gate is comment-sensitive: this
 * package's option JSDoc legitimately NAMES the subpath in a consumer example,
 * so the grep is non-empty and a human has to adjudicate it every time. These
 * assertions restate the guardrail in a form that cannot be tripped by prose
 * and cannot be forgotten — they fail only on a genuine dependency or a
 * genuine module-specifier position.
 */
describe('G3: the plugin never depends on or imports @animus-ui/system', () => {
  const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..');

  test('no @animus-ui/system entry in any package.json dependency field', () => {
    const manifest = JSON.parse(
      readFileSync(join(packageDir, 'package.json'), 'utf-8')
    ) as Record<string, Record<string, string> | undefined>;

    for (const field of [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies',
    ]) {
      const names = Object.keys(manifest[field] ?? {});
      expect(
        names.filter(
          (n) => n === '@animus-ui/system' || n.startsWith('@animus-ui/system/')
        ),
        `${field} must not name @animus-ui/system`
      ).toEqual([]);
    }
  });

  test('no src/ file has an import/export/require targeting @animus-ui/system', () => {
    const srcDir = join(packageDir, 'src');
    const files = readdirSync(srcDir, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && /\.[cm]?tsx?$/.test(e.name))
      .map((e) => join(e.parentPath, e.name));

    // Non-vacuity: the scan must actually have files to scan.
    expect(files.length).toBeGreaterThan(0);

    // Genuine specifier positions only — a `*`-prefixed JSDoc line naming the
    // subpath is prose and must NOT trip this.
    const specifierRE = /^\s*(?:import|export)[^'"]*['"]@animus-ui\/system/m;
    const requireRE = /\brequire\(\s*['"]@animus-ui\/system/;

    const offenders = files.filter((file) => {
      const source = readFileSync(file, 'utf-8');
      return specifierRE.test(source) || requireRE.test(source);
    });

    expect(offenders, 'these files import @animus-ui/system').toEqual([]);
  });

  test('the witness would catch a real import (regex non-vacuity)', () => {
    const specifierRE = /^\s*(?:import|export)[^'"]*['"]@animus-ui\/system/m;

    // Positive controls — genuine specifier positions.
    expect(
      specifierRE.test(
        "import { createAppearanceBootstrap } from '@animus-ui/system/bootstrap';"
      )
    ).toBe(true);
    expect(
      specifierRE.test('export type { X } from "@animus-ui/system";')
    ).toBe(true);

    // Negative control — the exact JSDoc line that makes the grep non-empty.
    expect(
      specifierRE.test(
        "   * import { createAppearanceBootstrap } from '@animus-ui/system/bootstrap';"
      )
    ).toBe(false);
  });
});

/**
 * Structural-mirror type parity — Shape A of the pair
 * (openspec: system-color-scheme, cross-cutting 2.1; inc-03 review).
 *
 * `AnimusExtractOptions['appearanceBootstrap']` is declared INLINE as
 * `{ code: string; cspHash: string }` precisely so this package never imports
 * `@animus-ui/system` (G3, asserted above). The cost of that isolation is that
 * no compiler edge connects the mirror to `AppearanceBootstrapArtifact` — they
 * can drift in silence.
 *
 * This is the source-text half of the fix: it reads the generator's declaration
 * off disk and pins its MEMBER NAMES. `readFileSync` of a relative path is not
 * an import specifier, so the topology stays clean and no dependency is added.
 * The twin — Shape B, an `Exact<>` assignability assertion that also catches
 * member-TYPE drift — lives in
 * `packages/system/__tests__/appearance-artifact-parity.test-d.ts` and runs
 * under `vp run verify:types`.
 */
describe('Shape A: the inline artifact mirror tracks AppearanceBootstrapArtifact', () => {
  const generatorPath = join(
    dirname(fileURLToPath(import.meta.url)),
    '../../system/src/bootstrap/createAppearanceBootstrap.ts'
  );

  /** The members of the plugin's inline mirror, sorted. */
  const MIRROR_MEMBERS = ['code', 'cspHash'];

  /**
   * Member names of `export interface <name>` in a TS source string.
   *
   * Comments are stripped BEFORE the interface is located: this particular
   * interface documents the CSP header inside a fenced JSDoc block, so prose
   * would otherwise be parsed as declarations.
   */
  function interfaceMemberNames(source: string, name: string): string[] {
    const withoutComments = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[^\n'"`]*?\/\/.*$/gm, '');

    const body = new RegExp(`export interface ${name}\\s*\\{([^}]*)\\}`).exec(
      withoutComments
    )?.[1];

    if (body === undefined) {
      throw new Error(
        `interfaceMemberNames: no 'export interface ${name}' found — the declaration was renamed, moved, or is no longer exported.`
      );
    }

    return body
      .split('\n')
      .map(
        (line) =>
          /^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*\??\s*:/.exec(line)?.[1]
      )
      .filter((member): member is string => member !== undefined)
      .sort();
  }

  test('AppearanceBootstrapArtifact declares exactly the mirrored members', () => {
    const members = interfaceMemberNames(
      readFileSync(generatorPath, 'utf-8'),
      'AppearanceBootstrapArtifact'
    );

    expect(
      members,
      `AppearanceBootstrapArtifact changed shape. The inline mirror in packages/vite-plugin/src/index.ts (AnimusExtractOptions['appearanceBootstrap']: { code: string; cspHash: string }) and its twin in packages/system/__tests__/appearance-artifact-parity.test-d.ts must be updated to match — the plugin deliberately does not import the type (G3), so nothing else will catch this.`
    ).toEqual(MIRROR_MEMBERS);
  });

  test('the parser is non-vacuous (it reads members, not whitespace)', () => {
    const control = [
      '/** {@link Something} — a doc block with a brace. */',
      'export interface Control {',
      '  /** leading prose: not a member */',
      '  alpha: string;',
      '  // line comment: not a member',
      '  beta?: number;',
      '  readonly gamma: boolean;',
      '}',
    ].join('\n');

    expect(interfaceMemberNames(control, 'Control')).toEqual([
      'alpha',
      'beta',
      'gamma',
    ]);
  });

  test('a missing declaration fails loudly rather than passing empty', () => {
    expect(() =>
      interfaceMemberNames('export interface Other { a: string }', 'Control')
    ).toThrow(/no 'export interface Control' found/);
  });
});

describe('Vite injection option: absent by default (G4 parity)', () => {
  test('unconfigured output matches the pre-change descriptor shape', () => {
    const tags = buildIndexHtmlTags(contextWith());

    expect(tags).toEqual([PRE_CHANGE_LAYER_TAG]);
    // No empty tags, no attribute stubs — the word "bootstrap" cannot appear.
    expect(JSON.stringify(tags)).not.toContain('bootstrap');
  });

  test('unconfigured and no layer declaration still returns an empty array', () => {
    const tags = buildIndexHtmlTags(contextWith({ layerDeclaration: '' }));

    expect(tags).toEqual([]);
  });

  test('the real plugin hook takes the empty branch of the same builder', () => {
    const plugin = animusExtract({ system: './ds.ts' });
    const hook = plugin.transformIndexHtml;

    // Object form with `order: 'pre'` — unchanged by this increment.
    if (typeof hook !== 'object' || hook === null || !('handler' in hook)) {
      throw new Error(
        'transformIndexHtml must stay in object-with-handler form'
      );
    }
    expect(hook.order).toBe('pre');

    // Drive the real `configResolved` into BUILD mode first. Without it the
    // context is in dev and the builder's dev-only bridge tag rides along,
    // which would cost this test its exact-array pin — the one assertion that
    // proves an unconfigured build emits no tag, attribute, or whitespace of
    // its own. `command: 'build'` is the only field the emptiness depends on.
    const configResolved = plugin.configResolved;
    if (typeof configResolved !== 'function') {
      throw new Error('configResolved must stay in plain-function form');
    }
    (configResolved as (config: never) => void).call(
      plugin as never,
      {
        command: 'build',
        root: process.cwd(),
        base: '/',
      } as never
    );

    // SCOPE: `ctx.layerDeclaration` is '' until buildStart runs (which needs
    // the NAPI engine), so this can only ever observe the EMPTY branch of the
    // bootstrap/layer pair. It pins the hook's wiring — object form,
    // `order: 'pre'`, delegation to buildIndexHtmlTags — not the layer-present
    // output. The production path with a real layer declaration is covered by
    // `vp run verify:integration` and by the built-HTML assertions in the
    // consumer verify lanes.
    const result = (
      hook.handler as (...args: never[]) => HtmlTagDescriptor[]
    ).call(plugin as never);

    expect(result).toEqual([]);
  });
});
