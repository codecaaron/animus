import { isJsonObject } from '@animus-ui/assertions';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSync, Visitor } from 'oxc-parser';
import { resolveConfig } from 'vite';
import { describe, expect, test } from 'vitest';

import { animusExtract } from '../src/index';
import { buildIndexHtmlTags } from '../src/index-html';
import {
  contextWith,
  HTML_HOOK_CONTEXT,
  LAYER_DECLARATION,
} from './index-html-context';

import type { PluginContext } from '../src/context';
import type { JsonValue } from '@animus-ui/assertions';
import type { Node, StringLiteral } from 'oxc-parser';
import type { HtmlTagDescriptor } from 'vite';

/**
 * Vite buckets returned tags by `injectTo` and serializes each bucket in array
 * order, so array order is document order within one returned array.
 */

const ARTIFACT = {
  code: '(function(){try{var r=document.documentElement;r.removeAttribute("data-color-mode")}catch(e){}})();',
  cspHash: 'sha256-Zm9vYmFyYmF6',
};

/**
 * The only tag an unconfigured build emits. `children` is a pass-through of
 * `ctx.layerDeclaration`; the pins are tag, attrs and injectTo.
 */
const PRE_CHANGE_LAYER_TAG: HtmlTagDescriptor = {
  tag: 'style',
  attrs: { 'data-animus-layers': '' },
  children: LAYER_DECLARATION,
  injectTo: 'head-prepend',
};

function isSystemSpecifier(value: string): boolean {
  return (
    value === '@animus-ui/system' || value.startsWith('@animus-ui/system/')
  );
}

function isStringLiteral(node: Node): node is StringLiteral {
  return node.type === 'Literal' && String(node.value) === node.value;
}

function hasSystemModuleReference(file: string, source: string): boolean {
  const parsed = parseSync(file, source);
  if (parsed.errors.length > 0) {
    throw new Error(
      `OXC could not parse ${file}: ${JSON.stringify(parsed.errors)}`
    );
  }

  let found = false;
  new Visitor({
    ImportDeclaration(node) {
      if (isSystemSpecifier(node.source.value)) found = true;
    },
    ExportNamedDeclaration(node) {
      if (node.source && isSystemSpecifier(node.source.value)) found = true;
    },
    ExportAllDeclaration(node) {
      if (isSystemSpecifier(node.source.value)) found = true;
    },
    ImportExpression(node) {
      if (
        isStringLiteral(node.source) &&
        isSystemSpecifier(node.source.value)
      ) {
        found = true;
      }
    },
    CallExpression(node) {
      const firstArgument = node.arguments[0];
      if (
        node.callee.type === 'Identifier' &&
        node.callee.name === 'require' &&
        firstArgument &&
        isStringLiteral(firstArgument) &&
        isSystemSpecifier(firstArgument.value)
      ) {
        found = true;
      }
    },
  }).visit(parsed.program);
  return found;
}

/**
 * Build-mode context: `isProd` keeps the dev-only bridge tag out of frame, so
 * the exact-array assertions below state what an unconfigured build emits.
 */
function prodContext(
  overrides: {
    appearanceBootstrap?: { code: string; cspHash: string };
    layerDeclaration?: string;
  } = {}
): PluginContext {
  return contextWith({
    isProd: true,
    layerDeclaration: LAYER_DECLARATION,
    ...overrides,
  });
}

describe('Vite injection option: opt-in injection', () => {
  test('option present emits the artifact code verbatim in a marked script', () => {
    const tags = buildIndexHtmlTags(
      prodContext({ appearanceBootstrap: ARTIFACT })
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
      prodContext({ appearanceBootstrap: ARTIFACT })
    );

    const scriptIndex = tags.findIndex((t) => t.tag === 'script');
    const styleIndex = tags.findIndex((t) => t.tag === 'style');

    expect(scriptIndex).toBeGreaterThanOrEqual(0);
    expect(styleIndex).toBeGreaterThanOrEqual(0);
    expect(scriptIndex).toBeLessThan(styleIndex);
    // Every tag rides the same head-prepend bucket, so array order is
    // document order.
    expect(tags.every((t) => t.injectTo === 'head-prepend')).toBe(true);
  });

  test('injection does not depend on a layer declaration being present', () => {
    const tags = buildIndexHtmlTags(
      prodContext({ appearanceBootstrap: ARTIFACT, layerDeclaration: '' })
    );

    // The script carries `code` and nothing else the plugin was handed, so
    // `cspHash` has no position in the document to leak into.
    expect(tags).toEqual([
      {
        tag: 'script',
        attrs: { 'data-animus-bootstrap': '' },
        children: ARTIFACT.code,
        injectTo: 'head-prepend',
      },
    ]);
  });

  test('an empty-code artifact emits no script tag', () => {
    // An empty artifact is a caller defect: it must not leave an inert
    // `<script data-animus-bootstrap></script>` behind.
    const tags = buildIndexHtmlTags(
      prodContext({ appearanceBootstrap: { code: '', cspHash: '' } })
    );

    expect(tags.some((t) => t.tag === 'script')).toBe(false);
    expect(tags).toEqual([PRE_CHANGE_LAYER_TAG]);
    expect(JSON.stringify(tags)).not.toContain('bootstrap');

    expect(
      buildIndexHtmlTags(
        prodContext({
          appearanceBootstrap: { code: '', cspHash: '' },
          layerDeclaration: '',
        })
      )
    ).toEqual([]);
  });
});

/**
 * A text search for the subpath is tripped by option JSDoc that names it, so
 * isolation is asserted on parsed module specifiers instead.
 */
describe('G3: the plugin never depends on or imports @animus-ui/system', () => {
  const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..');

  test('no @animus-ui/system entry in any package.json dependency field', () => {
    const manifest: JsonValue = JSON.parse(
      readFileSync(join(packageDir, 'package.json'), 'utf-8')
    );
    if (!isJsonObject(manifest)) {
      throw new Error('vite-plugin package manifest must be a JSON object');
    }

    for (const field of [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies',
    ]) {
      const dependencies = manifest[field];
      if (dependencies !== undefined && !isJsonObject(dependencies)) {
        throw new Error(
          `vite-plugin package manifest.${field} must be an object`
        );
      }
      const names = Object.keys(dependencies ?? {});
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

    expect(files.length).toBeGreaterThan(0);

    const offenders = files.filter((file) => {
      const source = readFileSync(file, 'utf-8');
      return hasSystemModuleReference(file, source);
    });

    expect(offenders, 'these files import @animus-ui/system').toEqual([]);
  });

  test('the witness catches real module references without matching prose', () => {
    expect(
      hasSystemModuleReference(
        'fixture.ts',
        "import { createAppearanceBootstrap } from '@animus-ui/system/bootstrap';"
      )
    ).toBe(true);
    expect(
      hasSystemModuleReference(
        'fixture.ts',
        'export type { X } from "@animus-ui/system";'
      )
    ).toBe(true);
    expect(
      hasSystemModuleReference(
        'fixture.ts',
        "import {\n  createAppearanceBootstrap\n} from '@animus-ui/system/bootstrap';"
      )
    ).toBe(true);
    expect(
      hasSystemModuleReference(
        'fixture.ts',
        "export {\n  createAppearanceBootstrap\n} from '@animus-ui/system/bootstrap';"
      )
    ).toBe(true);
    expect(
      hasSystemModuleReference(
        'fixture.ts',
        "const runtime = require('@animus-ui/system/runtime');"
      )
    ).toBe(true);

    expect(
      hasSystemModuleReference(
        'fixture.ts',
        "/**\n * import { createAppearanceBootstrap } from '@animus-ui/system/bootstrap';\n */"
      )
    ).toBe(false);
    expect(
      hasSystemModuleReference(
        'fixture.ts',
        "export interface Options {\n  /** @default '@animus-ui/system' */\n  runtimeImport?: string;\n}"
      )
    ).toBe(false);
  });
});

/**
 * No compiler edge connects the plugin's inline artifact mirror to the
 * generator's interface, so its member names are pinned by reading the source.
 */
describe('Shape A: the inline artifact mirror tracks AppearanceBootstrapArtifact', () => {
  const generatorPath = join(
    dirname(fileURLToPath(import.meta.url)),
    '../../system/src/bootstrap/createAppearanceBootstrap.ts'
  );

  /** The members of the plugin's inline mirror, sorted. */
  const MIRROR_MEMBERS = ['code', 'cspHash'];

  /**
   * Comments are stripped before the interface is located: the declaration's
   * JSDoc carries braces and member-shaped prose.
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
    const tags = buildIndexHtmlTags(prodContext());

    expect(tags).toEqual([PRE_CHANGE_LAYER_TAG]);
    expect(JSON.stringify(tags)).not.toContain('bootstrap');
  });

  test('unconfigured and no layer declaration still returns an empty array', () => {
    const tags = buildIndexHtmlTags(prodContext({ layerDeclaration: '' }));

    expect(tags).toEqual([]);
  });

  test('the real plugin hook takes the empty branch of the same builder', async () => {
    const plugin = animusExtract({ system: './ds.ts' });
    const hook = plugin.transformIndexHtml;

    if (hook === undefined || !('handler' in hook)) {
      throw new Error(
        'transformIndexHtml must stay in object-with-handler form'
      );
    }
    expect(hook.order).toBe('pre');

    // Build mode first: in dev the builder's bridge tag rides along and the
    // exact-array pin below stops stating what a build emits.
    const configResolved = plugin.configResolved;
    if (configResolved === undefined || 'handler' in configResolved) {
      throw new Error('configResolved must stay in plain-function form');
    }
    await resolveConfig(
      {
        configFile: false,
        root: process.cwd(),
        base: '/',
        plugins: [plugin],
      },
      'build'
    );

    // `ctx.layerDeclaration` is '' until buildStart runs, so this observes the
    // empty branch: it pins the hook's wiring, not the layer-present output.
    const result = await hook.handler.call(HTML_HOOK_CONTEXT, '', {
      path: '/',
      filename: join(process.cwd(), 'index.html'),
    });
    if (!Array.isArray(result)) {
      throw new Error('transformIndexHtml must return tag descriptors');
    }

    expect(result).toEqual([]);
  });
});
