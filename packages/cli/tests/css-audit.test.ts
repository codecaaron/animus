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
import { formatCssAudit, runCssAudit } from '../src/css-audit';
import { EXIT_USAGE, exitCodeFor } from '../src/index';

import type { CssAuditReport } from '../src/css-audit';
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
    // The manifest with one site of `A` that writes `size` as `attr` adds.
    interface SizeExtra {
      enumerableValues?: Array<{ toString: number; valueOf: number }>;
    }
    const usingA = (attr: SizeExtra) => ({
      ...manifest,
      fileFacts: {
        'src/ui.tsx': {
          usage: [
            {
              element: {
                tag: { ident: 'A' },
                attrs: [{ name: 'size', dynamic: false, skip: false, ...attr }],
              },
            },
          ],
        },
      },
    });
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
      // A literal list entry that is an object, however it converts.
      usingA({ enumerableValues: [{ toString: 0, valueOf: 0 }] }),
      // A lookup table whose file holds no record.
      { ...usingA({}), tag_components: { 'src/ui.tsx': null } },
      {
        ...usingA({}),
        crossFile: {
          ...manifest.crossFile,
          memberBindings: { 'src/ui.tsx': null },
        },
      },
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
 *  Animus's layers in the shipped CSS that selects a class the manifest
 *  cannot emit is another build's; a class only a sheet holds (the
 *  color-mode scope of the global sheet) is still the manifest's. */
test('a manifest that does not match the dist exits 2', async () => {
  const root = mkdtempSync(join(tmpdir(), 'animus-css-audit-'));
  try {
    const { css, manifest, manifestPath, dist } = writeProject(root);
    const global = '@layer anm-global{.dark{--tone:1}}';
    // A manifest of no component, one dynamic slot.
    interface SlotOnly {
      components: Record<string, never>;
      files: Record<string, never>;
      component_fragments: Record<string, never>;
      dynamic_props: Record<string, { slotClass: string }>;
    }
    const write = (
      manifestCss: string,
      extra?: SlotOnly,
      manifestGlobal = global
    ) =>
      writeFileSync(
        manifestPath,
        JSON.stringify({
          ...manifest,
          css: manifestCss,
          sheets: { ...manifest.sheets, global: manifestGlobal },
          ...extra,
        })
      );
    const shipped = join(dist, 'assets', 'index.css');
    const accepts = async (output: string) => {
      writeFileSync(shipped, output);
      await expect(
        runCssAudit({ manifest: manifestPath, dist })
      ).resolves.toBeDefined();
    };
    const refuses = async (output: string) => {
      writeFileSync(shipped, output);
      await expect(
        runCssAudit({ manifest: manifestPath, dist })
      ).rejects.toBeInstanceOf(UsageFailure);
    };
    write(css);
    await accepts(css + global);
    // Components that ship only a shared utility (every one unbundled but
    // `.animus-x`), or none beside the global sheet and the app's own CSS,
    // are still this manifest's build.
    await accepts('@layer anm-system{.animus-x{margin:var(--space)}}');
    await accepts(global);
    await accepts(`${global}.app{color:red}`);
    // A class inside a selector function's argument is compared too, on
    // either side: a global the build writes `:is(.theme)` ships minified.
    await refuses(`${css}@layer anm-base{:is(.animus-A-b518d794){color:red}}`);
    await refuses(`${css}@layer anm-base{:where(.foreign){color:red}}`);
    write(css, undefined, '@layer anm-global{:is(.theme){--x:1}}');
    await accepts(`${css}@layer anm-global{.theme{--x:1}}`);
    write(css);
    // An Animus layer however its prelude is written: comments, case, or a
    // layer nested in one.
    for (const prelude of [
      '/**/anm-base',
      ' /* c */ anm-base',
      ' ANM-BASE',
      ' anm-base.inner',
    ]) {
      await refuses(`${css}@layer${prelude}{.animus-Z-1{color:red}}`);
    }
    // A component's color-mode scope selects the shared class: the component
    // named from another fingerprint is another build's.
    write(`${css}@layer anm-states{.dark .animus-A{color:red}}`);
    await refuses(
      `${global}@layer anm-states{.dark .animus-A-c3f8ffdb{color:blue}}`
    );
    // So is another configuration's dynamic slot class, though no component
    // or utility is named.
    write('@layer anm-system{.animus-dyn-p_{padding:var(--animus-dyn-p)}}', {
      components: {},
      files: {},
      component_fragments: {},
      dynamic_props: { p: { slotClass: 'animus-dyn-p_' } },
    });
    await refuses(
      '@layer anm-system{.animus-dyn-pad_{padding:var(--animus-dyn-pad)}}'
    );

    write(css);
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

/** Contract: unlayered output is audited with a warning, never refused or
 *  silently trusted. Without Animus's layers a class name alone cannot tell
 *  another build's classes from the app's. */
test('unlayered output is audited with a warning, never refused or silently trusted', async () => {
  const root = mkdtempSync(join(tmpdir(), 'animus-css-audit-'));
  try {
    const { css, manifest, manifestPath, dist } = writeProject(root);
    const shipped = join(dist, 'assets', 'index.css');
    const warned = async (files: Record<string, string>) => {
      rmSync(join(dist, 'assets'), { recursive: true, force: true });
      mkdirSync(join(dist, 'assets'), { recursive: true });
      for (const [file, text] of Object.entries(files)) {
        writeFileSync(join(dist, 'assets', file), text);
      }
      return (await runCssAudit({ manifest: manifestPath, dist })).warnings;
    };
    const warning = (files: string, verb = 'has', them = 'it') =>
      `css audit: ${files} ${verb} classes and no Animus layers, so the audit cannot confirm this manifest comes from the same build as ${them}`;
    writeFileSync(shipped, '.dark{--tone:1}.animus-A-c3f8ffdb{color:blue}');
    const unlayered = await runCssAudit({ manifest: manifestPath, dist });
    expect(unlayered.warnings).toEqual([warning('assets/index.css')]);
    expect(formatCssAudit(unlayered)).toContain(
      `warning: ${warning('assets/index.css')}`
    );
    expect(await warned({ 'index.css': css })).toEqual([]);
    // Layers are read from the parsed rules: one written only in a comment
    // or a string is none, and an upper-case at-keyword is one.
    expect(
      await warned({ 'index.css': '/* @layer anm-base{} */.x{color:red}' })
    ).toEqual([warning('assets/index.css')]);
    expect(
      await warned({ 'index.css': '.x{content:"@layer anm-base{"}' })
    ).toEqual([warning('assets/index.css')]);
    expect(
      await warned({ 'index.css': css.replaceAll('@layer', '@LAYER') })
    ).toEqual([]);
    // Beside layered output, a file with classes and no layers is another
    // stylesheet the app ships, unless the manifest emits classes outside
    // its layers (a global registered unlayered): then a layered file does
    // not vouch for it.
    const mixed = { 'index.css': css, 'theme.css': '.new-global{--x:1}' };
    expect(await warned(mixed)).toEqual([]);
    writeFileSync(
      manifestPath,
      JSON.stringify({
        ...manifest,
        sheets: { ...manifest.sheets, global: '.old-global{--x:1}' },
      })
    );
    expect(await warned(mixed)).toEqual([warning('assets/theme.css')]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/** Contract: a kept option with a dynamic site is never ranked. Where a
 *  site passes a value no literal spells (a wrapper's own prop, a local, a
 *  value its component's parameters reach), the audit cannot prove which
 *  options it passes, so the finding is never ranked and no saving total
 *  counts it; where every site is literal there is no finding, since the
 *  engine prunes what none writes. */
test('a kept option with a dynamic site is never ranked, and no saving total counts it', async () => {
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
      staticValue: string | null | object;
      dynamic: boolean;
      skip: boolean;
      dynamicSpan?: { start: number; end: number };
    }
    const literal = (value: string): SizeAttr => ({
      name: 'size',
      staticValue: value,
      dynamic: false,
      skip: false,
    });
    // Written on the second line of the site's file.
    const dynamic: SizeAttr = {
      name: 'size',
      staticValue: null,
      dynamic: true,
      skip: false,
      dynamicSpan: { start: 9, end: 13 },
    };
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(
      join(root, 'src', 'app.tsx'),
      '// sites\n<Chip size={size} />\n'
    );
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
    let report: CssAuditReport | undefined;
    const chipFinding = async () => {
      report = await runCssAudit({ manifest: manifestPath, dist, root });
      return report.restructures.findings.find(
        (finding) => finding.components[0] === 'src/ui.tsx::Chip'
      );
    };

    // One site writes `lg`, one passes a value no literal spells (a
    // wrapper's own prop, a reassigned or destructured one, a nested
    // component's): `sm` is listed, never ranked.
    write([[literal('lg')], [dynamic]]);
    const kept = await chipFinding();
    expect(kept?.title).toBe('Chip: 1 option unproven (size: sm)');
    // Never ranked, nor counted below the floor, in the JSON either.
    expect(kept?.belowFloor).toBe(false);
    expect(kept?.caveats[0]).toContain('kept by 1 dynamic site;');
    // The JSON says so too, with every site, not only its caveat's text.
    expect(kept?.unproven).toEqual({ dynamicSites: ['src/app.tsx:2'] });
    // The text names it as kept, with its site, and no total or saving
    // counts its bytes: only a measured finding's do.
    const { unproven: _, ...measured } = kept!;
    const text = formatCssAudit({
      ...report!,
      restructures: {
        ...report!.restructures,
        findings: [
          ...report!.restructures.findings,
          {
            ...measured,
            title: 'measured',
            belowFloor: true,
            saving: { raw: 7, gzip: null, brotli: null },
          },
        ],
      },
    });
    expect(text).toContain('Below the floor: 1 findings, 7 B raw together');
    const named = text.split('\n').filter((line) => line.includes('Chip:'));
    expect(named).toEqual([
      expect.stringContaining('kept by 1 dynamic site: src/app.tsx:2'),
    ]);
    expect(named[0]).not.toMatch(/\b(br|gz|raw) \d/);
    // A static value that is no literal (a `style` object), however it
    // converts, is a value no literal spells.
    write([
      [literal('lg')],
      [{ ...literal(''), staticValue: { toString: 0, valueOf: 0 } }],
    ]);
    expect((await chipFinding())?.unproven).toBeDefined();

    // Every site literal: the engine prunes, so there is nothing to list.
    // The `constructor` axis, which lists no options, reads no inherited one.
    write([[literal('lg')], [literal('sm')]]);
    expect(await chipFinding()).toBeUndefined();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
