import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';
import { expect, test } from 'vitest';

import { runCssAudit } from '../src/css-audit';

import type {
  FullProjectManifest,
  ManifestComponentDescriptor,
} from '@animus-ui/extract/pipeline';

const brotli = (text: string): number =>
  brotliCompressSync(Buffer.from(text), {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_LGWIN]: 22,
      [constants.BROTLI_PARAM_SIZE_HINT]: Buffer.byteLength(text),
    },
  }).length;

const component = (binding: string): ManifestComponentDescriptor => ({
  file: 'src/ui.tsx',
  binding,
  class_name: `animus-${binding}`,
  extends_from: null,
  terminal: 'asElement',
  tag: 'div',
  replacement: `createComponent('div', 'animus-${binding}', {})`,
  system_prop_names: [],
  definition_fingerprint: binding,
});

const WIDE =
  'display:flex;flex-direction:column;align-items:center;gap:12px;padding:8px';
const NARROW = 'display:grid;place-items:center;margin:0';
const MEMBERS = { wide: ['A', 'B', 'C'], narrow: ['D', 'E'] };

function snapshot(dir: string) {
  const files: Record<string, string> = {};
  const walk = (at: string) => {
    for (const entry of readdirSync(at)) {
      const path = join(at, entry);
      if (statSync(path).isDirectory()) walk(path);
      else files[path] = readFileSync(path, 'base64');
    }
  };
  walk(dir);
  return files;
}

test('the audit ranks findings by measured compressed savings and writes nothing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'animus-css-audit-'));
  const all = [...MEMBERS.wide, ...MEMBERS.narrow];
  const rules = [
    ...MEMBERS.wide.map((name) => `.animus-${name}{${WIDE}}`),
    ...MEMBERS.narrow.map((name) => `.animus-${name}{${NARROW}}`),
  ];
  const css = `:root{--space:4px}@layer anm-base{${rules.join('')}}@layer anm-system{.animus-x{margin:var(--space)}}`;
  const components = Object.fromEntries(
    all.map((name) => [`src/ui.tsx::${name}`, component(name)])
  );
  const manifest: FullProjectManifest = {
    parseCount: 1,
    css,
    sheets: {
      declaration: '',
      global: '',
      base: '',
      variants: '',
      compounds: '',
      states: '',
      system: '',
      custom: '',
    },
    diagnostics: [],
    report: {
      components_total: all.length,
      components_extracted: all.length,
      components_eliminated: 0,
      variants_total: 0,
      variants_used: 0,
      variants_eliminated: 0,
      states_total: 0,
      states_used: 0,
      states_eliminated: 0,
      components_forced: 0,
      variants_forced: 0,
      states_forced: 0,
      eliminated_details: [],
    },
    system_prop_map: {},
    dynamic_props: {},
    admitted_transforms: {},
    typed_system_props: [],
    system_fingerprint: 'fixture',
    reverse_provenance: {},
    components,
    files: { 'src/ui.tsx': Object.keys(components) },
    timing: { parseCount: 1 },
    fileFacts: {},
    crossFile: {
      componentNames: all,
      classResolvers: [],
      memberBindings: {},
      renderedComponents: all,
      variantOptions: {},
      stateNames: {},
    },
    usageResidue: [],
    component_fragments: Object.fromEntries(
      all.map((name) => [`src/ui.tsx::${name}`, { base: '' }])
    ),
  };
  const manifestPath = join(root, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest));
  mkdirSync(join(root, 'dist', 'assets'), { recursive: true });
  writeFileSync(join(root, 'dist', 'assets', 'index.css'), css);
  writeFileSync(
    join(root, 'dist', 'assets', 'index.js'),
    all.map((name) => `"animus-${name}"`).join(';')
  );
  const before = snapshot(root);

  const report = await runCssAudit({
    manifest: manifestPath,
    dist: join(root, 'dist'),
  });

  const blocks = report.restructures.findings.filter(
    (finding) => finding.kind === 'repeated-base-block'
  );
  expect(blocks.map((finding) => finding.components)).toEqual([
    MEMBERS.wide.map((name) => `src/ui.tsx::${name}`),
    MEMBERS.narrow.map((name) => `src/ui.tsx::${name}`),
  ]);
  // Each saving is the shipped CSS recompressed with all but one member's
  // copy of its block cut.
  const without = (gone: string[]) =>
    css.replace(
      new RegExp(
        gone.map((name) => `\\.animus-${name}\\{[^}]*\\}`).join('|'),
        'g'
      ),
      ''
    );
  expect(blocks.map((finding) => finding.saving.brotli)).toEqual([
    brotli(css) - brotli(without(MEMBERS.wide.slice(1))),
    brotli(css) - brotli(without(MEMBERS.narrow.slice(1))),
  ]);
  const ranked = report.restructures.findings.map(
    (finding) => finding.saving.brotli ?? -Infinity
  );
  expect(ranked).toEqual([...ranked].sort((a, b) => b - a));
  expect(snapshot(root)).toEqual(before);
});
