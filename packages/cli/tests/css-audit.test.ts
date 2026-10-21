import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';
import { expect, test } from 'vitest';

import { UsageFailure } from '../src/build';
import { runCssAudit } from '../src/css-audit';
import { EXIT_USAGE, exitCodeFor } from '../src/index';

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

/** A project with a full manifest and its built output: two groups of
 *  components repeating a base block, one wider than the other. */
function writeProject(root: string) {
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
  return { css, manifest, manifestPath, dist: join(root, 'dist') };
}

test('the audit ranks findings by measured compressed savings and writes nothing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'animus-css-audit-'));
  try {
    const { css, manifestPath, dist } = writeProject(root);
    const before = snapshot(root);

    const report = await runCssAudit({ manifest: manifestPath, dist });

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
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an input the audit cannot read fails as a usage error, never a crash', async () => {
  const root = mkdtempSync(join(tmpdir(), 'animus-css-audit-'));
  try {
    const { manifest, manifestPath, dist } = writeProject(root);
    const broken = [
      {
        ...manifest,
        reverse_provenance: undefined,
        slot_provenance: { usage: null },
      },
      { ...manifest, fileFacts: { 'src/ui.tsx': null } },
      {
        ...manifest,
        fileFacts: {
          'src/ui.tsx': {
            usage: [
              {
                element: {
                  tag: { ident: 'A' },
                  attrs: [
                    {
                      name: 'size',
                      dynamic: true,
                      skip: false,
                      enumerableValues: {},
                    },
                  ],
                },
              },
            ],
          },
        },
      },
      { ...manifest, component_fragments: { 'src/ui.tsx::A': null } },
      {
        ...manifest,
        components: {
          'src/ui.tsx::A': { binding: 'A', class_name: 'animus-A' },
        },
      },
    ];
    for (const variant of broken) {
      writeFileSync(manifestPath, JSON.stringify(variant));
      await expect(
        runCssAudit({ manifest: manifestPath, dist })
      ).rejects.toBeInstanceOf(UsageFailure);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/** Contract: a manifest that does not match the dist exits 2. A rule of
 *  Animus's layers in the shipped CSS that selects a class the manifest's
 *  CSS or sheets do not is another build's; a class only a sheet holds
 *  (the color-mode scope of the global sheet) is still the manifest's. */
test('a manifest that does not match the dist exits 2', async () => {
  const root = mkdtempSync(join(tmpdir(), 'animus-css-audit-'));
  try {
    const { css, manifest, manifestPath, dist } = writeProject(root);
    const global = '@layer anm-global{.dark{--tone:1}}';
    writeFileSync(
      manifestPath,
      JSON.stringify({ ...manifest, sheets: { ...manifest.sheets, global } })
    );
    const shipped = join(dist, 'assets', 'index.css');
    writeFileSync(shipped, css + global);
    await expect(
      runCssAudit({ manifest: manifestPath, dist })
    ).resolves.toBeDefined();
    // Components that ship only a shared utility (every one unbundled but
    // `.animus-x`) are still this manifest's build.
    writeFileSync(shipped, '@layer anm-system{.animus-x{margin:var(--space)}}');
    await expect(
      runCssAudit({ manifest: manifestPath, dist })
    ).resolves.toBeDefined();
    // Unlayered output of another naming setting, sharing only the global
    // color-mode class: another build.
    writeFileSync(shipped, '.dark{--tone:1}.z-1{display:flex}');
    await expect(
      runCssAudit({ manifest: manifestPath, dist })
    ).rejects.toBeInstanceOf(UsageFailure);

    writeFileSync(
      shipped,
      css.replace('.animus-A{', '.animus-A-0f47f1e2{') + global
    );
    const audit = runCssAudit({ manifest: manifestPath, dist });
    await expect(audit).rejects.toBeInstanceOf(UsageFailure);
    await expect(audit).rejects.toSatisfy(
      (failure: UsageFailure) =>
        exitCodeFor(failure) === EXIT_USAGE &&
        failure.message.includes('animus-A-0f47f1e2')
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/** Contract: a kept option with a dynamic site is never ranked. Where a
 *  site passes a value no literal spells (a wrapper's own prop, a local, a
 *  value its component's parameters reach), the audit cannot prove which
 *  options it passes, so the finding stays below the floor; where every site
 *  is literal there is no finding, since the engine prunes what none writes. */
test('a kept option with a dynamic site is never ranked', async () => {
  const root = mkdtempSync(join(tmpdir(), 'animus-css-audit-'));
  try {
    const { manifest, manifestPath, dist } = writeProject(root);
    const chip: ManifestComponentDescriptor = {
      ...component('Chip'),
      replacement: `createComponent('div', 'animus-Chip', {"variants":{"size":{"options":["sm","md","lg"],"default":"md"},"constructor":{"default":"plain"}}})`,
    };
    const css = `@layer anm-variants{${['sm', 'md', 'lg']
      .map((size) => `.animus-Chip--size-${size}{${WIDE};font-size:${size}}`)
      .join('')}}`;
    interface SizeAttr {
      name: string;
      staticValue: string | null;
      dynamic: boolean;
      skip: boolean;
    }
    const literal = (value: string): SizeAttr => ({
      name: 'size',
      staticValue: value,
      dynamic: false,
      skip: false,
    });
    const dynamic: SizeAttr = {
      name: 'size',
      staticValue: null,
      dynamic: true,
      skip: false,
    };
    const write = (sites: SizeAttr[][]) => {
      writeFileSync(
        manifestPath,
        JSON.stringify({
          ...manifest,
          css,
          components: { 'src/ui.tsx::Chip': chip },
          files: { 'src/ui.tsx': ['src/ui.tsx::Chip'] },
          component_fragments: { 'src/ui.tsx::Chip': { variants: '' } },
          tag_components: { 'src/app.tsx': { Chip: 'src/ui.tsx::Chip' } },
          fileFacts: {
            'src/app.tsx': {
              usage: sites.map((attrs) => ({
                element: { tag: { ident: 'Chip' }, attrs },
              })),
            },
          },
        })
      );
      writeFileSync(join(dist, 'assets', 'index.css'), css);
      writeFileSync(join(dist, 'assets', 'index.js'), '"animus-Chip"');
    };
    const chipFinding = async () =>
      (
        await runCssAudit({ manifest: manifestPath, dist })
      ).restructures.findings.find(
        (finding) => finding.components[0] === 'src/ui.tsx::Chip'
      );

    // One site writes `lg`, one passes a value no literal spells (a
    // wrapper's own prop, a reassigned or destructured one, a nested
    // component's): `sm` is listed, never ranked.
    write([[literal('lg')], [dynamic]]);
    const kept = await chipFinding();
    expect(kept?.title).toContain('(size: sm)');
    expect(kept?.belowFloor).toBe(true);
    expect(kept?.caveats[0]).toContain('kept by 1 dynamic sites');

    // Every site literal: the engine prunes, so there is nothing to list.
    // The `constructor` axis, which lists no options, reads no inherited one.
    write([[literal('lg')], [literal('sm')]]);
    expect(await chipFinding()).toBeUndefined();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
