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

/** Manifest JSON, as these fixtures write it. */
type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

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
    // The manifest with one site of `A` that writes `size`.
    const usingA = () => ({
      ...manifest,
      fileFacts: {
        'src/ui.tsx': {
          proven: [
            {
              element: {
                tag: { ident: 'A' },
                attrs: [{ name: 'size', values: [], proven: true }],
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
            proven: [
              {
                element: {
                  tag: { ident: 'A' },
                  attrs: [{ name: 'size', values: {}, proven: false }],
                },
              },
            ],
          },
        },
      },
      // Raw usage with no proven usage beside it.
      {
        ...manifest,
        fileFacts: { 'src/ui.tsx': { usage: [] } },
      },
      { ...manifest, component_fragments: { 'src/ui.tsx::A': null } },
      // A lookup table whose file holds no record.
      { ...usingA(), tag_components: { 'src/ui.tsx': null } },
      {
        ...usingA(),
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
      values: Array<string | object>;
      proven: boolean;
      dynamicSpan?: { start: number; end: number };
    }
    const literal = (value: string): SizeAttr => ({
      name: 'size',
      values: [value],
      proven: true,
    });
    // Written on the second line of the site's file.
    const dynamic: SizeAttr = {
      name: 'size',
      values: [],
      proven: false,
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
              proven: sites.map((attrs) => ({
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
    expect(kept?.unproven).toEqual({
      dynamicSites: ['src/app.tsx:2'],
      forwards: [],
      derived: [],
      runtimeState: [],
      reachedByCallers: null,
      notPassedByMatchedCallers: null,
      matchedCallers: null,
      blocked: false,
      savingMeans: 'removed-if-proven-unreached',
    });
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
    expect(text).toContain('Below the floor: 1 finding, 7 B raw together');
    const named = text.split('\n').filter((line) => line.includes('Chip:'));
    expect(named).toEqual([
      expect.stringContaining('kept by 1 dynamic site: src/app.tsx:2'),
    ]);
    expect(named[0]).not.toMatch(/\b(br|gz|raw) \d/);
    // A static value that is no literal (a `style` object), however it
    // converts, is a value no literal spells.
    write([
      [literal('lg')],
      [{ ...literal(''), values: [{ toString: 0, valueOf: 0 }] }],
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

/** Contract: a forward's callers are evidence, never a verdict. The audit
 *  says which listed options the callers matched to the forwarding
 *  component through the module graph pass, and which none of them passes,
 *  with a caveat that unmatched callers or a branch before the render can
 *  differ; it never concludes that pruning would remove nothing, since a
 *  branch (`if (size !== 'sm') return null`) may keep a passed value from
 *  the render. A caller whose spread may replace the prop passes a value
 *  it cannot read; one of that name declared elsewhere is no caller. */
test("a forward's callers are evidence, never a verdict", async () => {
  const root = mkdtempSync(join(tmpdir(), 'animus-css-audit-'));
  try {
    const size = (value: string) => ({
      name: 'size',
      values: [value],
      proven: true,
    });
    const forward = {
      name: 'size',
      values: [],
      proven: false,
      dynamicSpan: { start: 0, end: 4 },
      forwarded: { component: 'Wrap', prop: 'size' },
    };
    interface Caller {
      tag: string;
      attrs: Array<ReturnType<typeof size>>;
      spread?: number;
    }
    const audit = (
      files: Record<string, Caller[]>,
      declarations: Record<string, Record<string, string>>
    ) =>
      forwardAudit(
        root,
        forward,
        Object.fromEntries(
          Object.entries(files).map(([file, callers]) => [
            file,
            callers.map(({ tag, attrs, spread }) => ({
              element: {
                tag: { ident: tag },
                attrs,
                ...(spread !== undefined && { spread }),
              },
            })),
          ])
        ),
        { tag_declarations: declarations }
      );
    const wrap = { 'src/app.tsx': { Wrap: 'src/wrap.tsx::Wrap' } };
    const callers = (...values: string[]) =>
      values.map((value) => ({ tag: 'Wrap', attrs: [size(value)] }));

    // Every matched caller passes a listed option, as where Wrap returns
    // early unless `size` is 'sm': the evidence is named, and no verdict.
    const all = await audit({ 'src/app.tsx': callers('sm', 'md', 'lg') }, wrap);
    expect(all.reachedByCallers).toEqual([
      { axis: 'size', options: ['sm', 'lg'] },
    ]);
    expect(all.notPassedByMatchedCallers).toEqual([]);
    expect(all.text).toContain(
      'callers matched through imports pass size: sm, lg; matched callers already pass every listed option. A caller the audit cannot match, or a branch before this render, can differ.'
    );
    expect(all.text).not.toMatch(/nothing to narrow|would remove none/i);
    // An option no matched caller passes is a candidate.
    const one = await audit({ 'src/app.tsx': callers('sm') }, wrap);
    expect(one.notPassedByMatchedCallers).toEqual(['size: lg']);
    expect(one.text).toContain('options no matched caller passes: size: lg');

    // A spread after the attribute may replace it; one before it cannot.
    const spread = (at: number) =>
      callers('sm', 'lg').map((caller) => ({ ...caller, spread: at }));
    const replaced = await audit({ 'src/app.tsx': spread(1) }, wrap);
    expect(replaced.notPassedByMatchedCallers).toBeNull();
    expect(replaced.text).toContain(
      'a matched caller passes a value the audit cannot read'
    );
    expect(
      (await audit({ 'src/app.tsx': spread(0) }, wrap))
        .notPassedByMatchedCallers
    ).toEqual([]);

    // Callers of that name the engine resolves nowhere are not counted.
    const unresolved = await audit(
      { 'src/app.tsx': callers('sm'), 'src/other.tsx': callers('lg') },
      wrap
    );
    expect(unresolved.reachedByCallers).toEqual([
      { axis: 'size', options: ['sm'] },
    ]);

    // An alias of the import is a caller; another module's own `Wrap` is not.
    const elsewhere = await audit(
      {
        'src/app.tsx': [{ tag: 'Alias', attrs: [size('sm')] }],
        'src/other.tsx': callers('sm', 'md', 'lg'),
      },
      {
        'src/app.tsx': { Alias: 'src/wrap.tsx::Wrap' },
        'src/other.tsx': { Wrap: 'src/other.tsx::Wrap' },
      }
    );
    expect(elsewhere.notPassedByMatchedCallers).toEqual(['size: lg']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/** The manifest sections a `forwardAudit` project adds. */
type ForwardExtra = Partial<
  Pick<
    FullProjectManifest,
    | 'tag_components'
    | 'tag_declarations'
    | 'as_component_targets'
    | 'unmatched_routes'
    | 'slot_provenance'
    | 'components'
  >
>;

/** A project whose `src/wrap.tsx` renders Chip (size sm, md, lg; default
 *  md) with `site`, and whose other files hold the given proven usage. */
async function forwardAudit(
  root: string,
  site: JsonValue,
  files: Record<string, JsonValue[]>,
  extra: ForwardExtra = {},
  sources: Record<string, string> = {}
) {
  const { manifest, manifestPath, dist } = writeProject(root);
  const chip: ManifestComponentDescriptor = {
    ...component('Chip'),
    replacement: `createComponent('div', 'animus-Chip', {"variants":{"size":{"options":["sm","md","lg"],"default":"md"}}})`,
  };
  const css = `@layer anm-variants{${['sm', 'md', 'lg']
    .map((size) => `.animus-Chip--size-${size}{${WIDE};font-size:${size}}`)
    .join('')}}`;
  mkdirSync(join(root, 'src'), { recursive: true });
  for (const [file, text] of Object.entries(sources)) {
    writeFileSync(join(root, file), text);
  }
  writeFileSync(
    manifestPath,
    JSON.stringify({
      ...manifest,
      css,
      ...extra,
      components: { 'src/ui.tsx::Chip': chip, ...extra.components },
      files: { 'src/ui.tsx': ['src/ui.tsx::Chip'] },
      component_fragments: { 'src/ui.tsx::Chip': { variants: '' } },
      tag_components: {
        'src/wrap.tsx': { Chip: 'src/ui.tsx::Chip' },
        ...extra.tag_components,
      },
      fileFacts: {
        'src/wrap.tsx': {
          proven: [
            { element: { tag: { ident: 'Chip' }, attrs: [site] } },
            ...(files['src/wrap.tsx'] ?? []),
          ],
        },
        ...Object.fromEntries(
          Object.entries(files)
            .filter(([file]) => file !== 'src/wrap.tsx')
            .map(([file, proven]) => [file, { proven }])
        ),
      },
    })
  );
  writeFileSync(join(dist, 'assets', 'index.css'), css);
  writeFileSync(join(dist, 'assets', 'index.js'), '"animus-Chip"');
  const report = await runCssAudit({ manifest: manifestPath, dist, root });
  const finding = report.restructures.findings.find(
    (found) => found.components[0] === 'src/ui.tsx::Chip'
  );
  return {
    ...finding?.unproven,
    suggestion: finding?.suggestion,
    hold: report.restructures.pruningHold,
    text: formatCssAudit(report),
  };
}

/** Contract: a forward's callers are read through what passes their values
 *  on. A caller that passes on its own component's prop, by an attribute
 *  or a spread of its props, is read through that component's callers,
 *  named, however many times it renders the forward; a member of an object
 *  prop is read off the object a caller writes; a `prop ?? literal`
 *  forward takes the literal where a caller leaves the prop out or passes
 *  null, and a `prop ?? undefined` one passes a null on as left out, which
 *  takes the next component's default; a caller's value that may be
 *  `undefined` or `null` also passes what leaving it out does and what a
 *  null does, and is not read before a spread that may replace it; a
 *  spread of the props passes a null on; an `.asComponent()`
 *  component's sites are its target's callers, without what it keeps back
 *  (`forward: true` keeps nothing back), and with its forwarded default
 *  for a null as for a prop left out; a
 *  component also reached by a route the matching misses gives no options
 *  left out; and callers in the forwarding component's own module are
 *  named so. */
test("a forward's callers are read through what passes their values on", async () => {
  const root = mkdtempSync(join(tmpdir(), 'animus-css-audit-'));
  try {
    const forward = (fact: JsonValue) => ({
      name: 'size',
      values: [],
      proven: false,
      dynamicSpan: { start: 0, end: 4 },
      forwarded: fact,
    });
    const literal = (name: string, value: JsonValue) => ({
      name,
      values: [value],
      proven: true,
    });
    const tag = (
      ident: string,
      attrs: JsonValue[],
      more: { spread?: number; spreadForward?: { component: string } } = {}
    ) => ({ element: { tag: { ident }, attrs, ...more } });
    const declared = (map: Record<string, Record<string, string>>) => ({
      tag_declarations: map,
    });
    const wrap = forward({ component: 'Wrap', prop: 'size' });

    // Outer passes its own size on to Wrap, by an attribute and by a spread.
    const chained = await forwardAudit(
      root,
      wrap,
      {
        'src/outer.tsx': [
          tag('Wrap', [forward({ component: 'Outer', prop: 'size' })]),
          tag('Wrap', [], {
            spread: 0,
            spreadForward: { component: 'Spread' },
          }),
        ],
        'src/app.tsx': [
          tag('Outer', [literal('size', 'lg')]),
          tag('Spread', [literal('size', 'sm')]),
        ],
      },
      declared({
        'src/outer.tsx': { Wrap: 'src/wrap.tsx::Wrap' },
        'src/app.tsx': {
          Outer: 'src/outer.tsx::Outer',
          Spread: 'src/outer.tsx::Spread',
        },
      })
    );
    expect(chained.reachedByCallers).toEqual([
      { axis: 'size', options: ['sm', 'lg'] },
    ]);
    expect(chained.text).toContain(
      '(with the callers of Outer, Spread, which pass it on)'
    );
    // A caller's proven value that may be `undefined` also passes what
    // leaving the prop out does.
    const maybe = await forwardAudit(
      root,
      forward({ component: 'Wrap', prop: 'size', default: 'lg' }),
      {
        'src/app.tsx': [
          tag('Wrap', [
            { name: 'size', values: ['sm'], proven: true, absent: true },
          ]),
        ],
      },
      declared({ 'src/app.tsx': { Wrap: 'src/wrap.tsx::Wrap' } })
    );
    expect(maybe.reachedByCallers).toEqual([
      { axis: 'size', options: ['sm', 'lg'] },
    ]);
    // `size ?? undefined` passes a `null` on as `undefined`, which takes
    // the next component's parameter default.
    const nullToDefault = await forwardAudit(
      root,
      forward({ component: 'Inner', prop: 'size', default: 'lg' }),
      {
        'src/outer.tsx': [
          tag('Inner', [
            forward({
              component: 'Outer',
              prop: 'size',
              nullToUndefined: true,
            }),
          ]),
        ],
        'src/app.tsx': [tag('Outer', [literal('size', null)])],
      },
      declared({
        'src/outer.tsx': { Inner: 'src/wrap.tsx::Inner' },
        'src/app.tsx': { Outer: 'src/outer.tsx::Outer' },
      })
    );
    expect(nullToDefault.reachedByCallers).toEqual([
      { axis: 'size', options: ['lg'] },
    ]);
    // Through Outer's `size = 'md'`, a value that may be `undefined` or
    // `null` passes 'md' left out and Wrap's `?? 'sm'` for a null.
    const absentOrNull = await forwardAudit(
      root,
      forward({ component: 'Wrap', prop: 'size', nullish: 'sm' }),
      {
        'src/outer.tsx': [
          tag('Wrap', [
            forward({ component: 'Outer', prop: 'size', default: 'md' }),
          ]),
        ],
        'src/app.tsx': [
          tag('Outer', [
            { name: 'size', values: ['lg'], proven: true, absent: true },
          ]),
        ],
      },
      declared({
        'src/outer.tsx': { Wrap: 'src/wrap.tsx::Wrap' },
        'src/app.tsx': { Outer: 'src/outer.tsx::Outer' },
      })
    );
    expect(absentOrNull.reachedByCallers).toEqual([
      { axis: 'size', options: ['sm', 'lg'] },
    ]);
    // A spread of the props passes a `null` on to Wrap's `?? 'sm'`.
    const spreadNull = await forwardAudit(
      root,
      forward({ component: 'Wrap', prop: 'size', nullish: 'sm' }),
      {
        'src/outer.tsx': [
          tag('Wrap', [], { spread: 0, spreadForward: { component: 'Outer' } }),
        ],
        'src/app.tsx': [tag('Outer', [literal('size', null)])],
      },
      declared({
        'src/outer.tsx': { Wrap: 'src/wrap.tsx::Wrap' },
        'src/app.tsx': { Outer: 'src/outer.tsx::Outer' },
      })
    );
    expect(spreadNull.reachedByCallers).toEqual([
      { axis: 'size', options: ['sm'] },
    ]);
    // A value that may be `undefined`, before a spread that may replace
    // it, is not read as the one value the spread falls back to.
    const absentBeforeSpread = await forwardAudit(
      root,
      wrap,
      {
        'src/outer.tsx': [
          tag(
            'Wrap',
            [{ name: 'size', values: ['sm'], proven: true, absent: true }],
            { spread: 1, spreadForward: { component: 'Outer' } }
          ),
        ],
        'src/app.tsx': [tag('Outer', [])],
      },
      declared({
        'src/outer.tsx': { Wrap: 'src/wrap.tsx::Wrap' },
        'src/app.tsx': { Outer: 'src/outer.tsx::Outer' },
      })
    );
    expect(absentBeforeSpread.text).toContain(
      'a matched caller passes a value the audit cannot read'
    );
    // A component that renders the forward twice is read once per render.
    const twice = await forwardAudit(
      root,
      wrap,
      {
        'src/outer.tsx': [
          tag('Wrap', [forward({ component: 'Outer', prop: 'size' })]),
          tag('Wrap', [forward({ component: 'Outer', prop: 'size' })]),
        ],
        'src/app.tsx': [tag('Outer', [literal('size', 'lg')])],
      },
      declared({
        'src/outer.tsx': { Wrap: 'src/wrap.tsx::Wrap' },
        'src/app.tsx': { Outer: 'src/outer.tsx::Outer' },
      })
    );
    expect(twice.notPassedByMatchedCallers).toEqual(['size: sm']);

    // A member of an object prop, and a `?? 'sm'` forward left out or null.
    const member = await forwardAudit(
      root,
      forward({ component: 'Wrap', prop: 'buttonProps', path: ['size'] }),
      {
        'src/app.tsx': [tag('Wrap', [literal('buttonProps', { size: 'lg' })])],
      },
      declared({ 'src/app.tsx': { Wrap: 'src/wrap.tsx::Wrap' } })
    );
    expect(member.reachedByCallers).toEqual([
      { axis: 'size', options: ['lg'] },
    ]);
    for (const caller of [
      tag('Wrap', []),
      tag('Wrap', [literal('size', null)]),
    ]) {
      const nullish = await forwardAudit(
        root,
        forward({ component: 'Wrap', prop: 'size', nullish: 'sm' }),
        { 'src/app.tsx': [caller] },
        declared({ 'src/app.tsx': { Wrap: 'src/wrap.tsx::Wrap' } })
      );
      expect(nullish.reachedByCallers).toEqual([
        { axis: 'size', options: ['sm'] },
      ]);
    }

    // An `.asComponent()` component's sites pass what it does not keep back.
    const asComponent = (id: string, variants: string) => ({
      ...component(id),
      terminal: 'asComponent',
      replacement: `createComponent(Wrap, 'animus-${id}', {${variants}})`,
    });
    const through = await forwardAudit(
      root,
      wrap,
      {
        'src/app.tsx': [
          tag('Card', [literal('size', 'lg')]),
          tag('Select', [literal('size', 'sm')]),
        ],
      },
      {
        components: {
          'src/ui.tsx::Card': asComponent('Card', ''),
          'src/ui.tsx::Select': asComponent(
            'Select',
            '"variants":{"size":{"options":["sm","lg"],"default":"lg"}}'
          ),
        },
        tag_components: {
          'src/app.tsx': {
            Card: 'src/ui.tsx::Card',
            Select: 'src/ui.tsx::Select',
          },
        },
        as_component_targets: {
          'src/ui.tsx::Card': 'src/wrap.tsx::Wrap',
          'src/ui.tsx::Select': 'src/wrap.tsx::Wrap',
        },
      }
    );
    // Card passes size on; Select keeps its own size variant back.
    expect(through.reachedByCallers).toEqual([
      { axis: 'size', options: ['lg'] },
    ]);
    // One that forwards every variant (`forward: true`) passes it on.
    const forwardAll = await forwardAudit(
      root,
      wrap,
      { 'src/app.tsx': [tag('Pass', [literal('size', 'sm')])] },
      {
        components: {
          'src/ui.tsx::Pass': asComponent(
            'Pass',
            '"variants":{"size":{"options":["sm"]}},"forward":true,"states":["open"]'
          ),
        },
        tag_components: { 'src/app.tsx': { Pass: 'src/ui.tsx::Pass' } },
        as_component_targets: { 'src/ui.tsx::Pass': 'src/wrap.tsx::Wrap' },
      }
    );
    expect(forwardAll.reachedByCallers).toEqual([
      { axis: 'size', options: ['sm'] },
    ]);
    // It fills a forwarded default for `null` as for a prop left out.
    const filled = await forwardAudit(
      root,
      wrap,
      { 'src/app.tsx': [tag('Pass', [literal('size', null)])] },
      {
        components: {
          'src/ui.tsx::Pass': asComponent(
            'Pass',
            '"variants":{"size":{"options":["sm"],"default":"sm"}},"forward":true'
          ),
        },
        tag_components: { 'src/app.tsx': { Pass: 'src/ui.tsx::Pass' } },
        as_component_targets: { 'src/ui.tsx::Pass': 'src/wrap.tsx::Wrap' },
      }
    );
    expect(filled.reachedByCallers).toEqual([
      { axis: 'size', options: ['sm'] },
    ]);

    // A caller that passes a React state hook's state slot.
    const stateful = await forwardAudit(
      root,
      wrap,
      {
        'src/app.tsx': [
          tag('Wrap', [
            {
              name: 'size',
              values: [],
              proven: false,
              runtimeState: { hook: 'useState', at: 0 },
            },
          ]),
        ],
      },
      declared({ 'src/app.tsx': { Wrap: 'src/wrap.tsx::Wrap' } }),
      { 'src/app.tsx': "const [size] = useState('sm');\n" }
    );
    expect(stateful.text).toContain(
      'a matched caller passes runtime state (useState at src/app.tsx:1)'
    );

    // Callers in Wrap's own module, and a route the matching misses.
    const local = await forwardAudit(
      root,
      wrap,
      { 'src/wrap.tsx': [tag('Wrap', [literal('size', 'sm')])] },
      {
        ...declared({ 'src/wrap.tsx': { Wrap: 'src/wrap.tsx::Wrap' } }),
        unmatched_routes: ['src/wrap.tsx::Wrap'],
      }
    );
    expect(local.notPassedByMatchedCallers).toBeNull();
    expect(local.text).toContain(
      'callers matched in this module pass size: sm'
    );
    expect(local.text).toContain(
      'also reached where the audit cannot match its callers'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/** Contract: a derived or runtime-state site gets no site remedy, and the
 *  hold blocks every remedy. A value computed from its component's props
 *  names those props and points at its callers, never a literal at the
 *  site, which would drop them; a React state hook's state slot is kept as
 *  runtime state, with no remedy; a forward whose matched callers pass such
 *  a value gets no literal remedy at them; no remedy promises that options
 *  prune;
 *  and where code may patch a built-in every render reads through, the
 *  report says once that pruning is off and blocks each remedy. */
test('a derived or runtime-state site gets no site remedy, and the hold blocks every remedy', async () => {
  const root = mkdtempSync(join(tmpdir(), 'animus-css-audit-'));
  try {
    const site = (more: { [key: string]: JsonValue }) => ({
      name: 'size',
      values: [],
      proven: false,
      dynamicSpan: { start: 0, end: 4 },
      ...more,
    });
    const derived = await forwardAudit(
      root,
      site({
        derived: {
          component: 'Wrap',
          props: ['color'],
          through: 'parseThemeColor',
        },
      }),
      {}
    );
    expect(derived.suggestion).toContain(
      "derived from Wrap's color through parseThemeColor"
    );
    expect(derived.suggestion).not.toContain('At the site');
    expect(derived.reachedByCallers).toBeNull();

    const sources = {
      'src/wrap.tsx': "const x = 1;\nconst [mode] = useState('a');\n",
    };
    const state = await forwardAudit(
      root,
      site({ runtimeState: { hook: 'useState', at: 13 } }),
      {},
      {},
      sources
    );
    expect(state.text).toContain(
      'kept: runtime state (useState at src/wrap.tsx:2)'
    );
    expect(state.suggestion).toBe('');

    // So does a forward whose matched caller passes state, or a value
    // computed from its own component's props: no literal at the callers.
    const caller = (more: { [key: string]: JsonValue }) =>
      forwardAudit(
        root,
        site({ forwarded: { component: 'Wrap', prop: 'size' } }),
        {
          'src/outer.tsx': [
            { element: { tag: { ident: 'Wrap' }, attrs: [site(more)] } },
          ],
        },
        {
          tag_declarations: { 'src/outer.tsx': { Wrap: 'src/wrap.tsx::Wrap' } },
        },
        { 'src/outer.tsx': "const [size] = useState('sm');\n" }
      );
    const stateCaller = await caller({
      runtimeState: { hook: 'useState', at: 0 },
    });
    expect(stateCaller.suggestion).toBe(
      'A matched caller passes runtime state (useState at src/outer.tsx:1): no change is suggested there.'
    );
    const derivedCaller = await caller({
      derived: { component: 'Outer', props: ['mode'], through: 'parseSize' },
    });
    expect(derivedCaller.suggestion).toBe(
      "A matched caller passes a value derived from Outer's mode through parseSize (at src/outer.tsx:1): what Outer's callers pass decides it, so a change belongs at those callers; a literal there would drop Outer's prop."
    );

    const computed = await forwardAudit(root, site({}), {});
    expect(computed.suggestion).toContain(
      'would let it see which options that site reaches'
    );
    expect(computed.suggestion).not.toMatch(/prune/);

    const held = await forwardAudit(
      root,
      site({}),
      {},
      {
        slot_provenance: {
          usage: [
            { rule: 'patches-intrinsics', file: 'src/patch.ts', line: 3 },
          ],
          owners: {},
          props: {},
          components: {},
        },
      }
    );
    expect(held.hold).toEqual({
      patchSites: 1,
      firstSites: ['src/patch.ts:3'],
    });
    expect(held.text).toContain(
      'Variant and state pruning is off for this build: 1 site'
    );
    expect(held.suggestion).toMatch(/^Blocked:/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
