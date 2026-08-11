import { describe, expect, test } from 'vitest';

import { contentHash } from '../pipeline/content-hash';
import { preprocessMdx } from '../pipeline/mdx-preprocessor';
import {
  ingestSourceEntries,
  type ExtractFactsResult,
  type SourceIngestionOptions,
} from '../pipeline/source-ingestion';
import { adaptSvelteSource } from '../pipeline/svelte-source-adapter';

type FactFile = ExtractFactsResult['files'][string];

function emptyFacts(path: string): FactFile {
  return {
    path,
    chains: [],
    imports: [],
    exports: [],
    parseDiagnostics: [],
  };
}

function resolverFacts(
  path: string,
  binding = 'badge',
  exported = binding
): FactFile {
  return {
    ...emptyFacts(path),
    chains: [
      {
        descriptor: { binding, terminal: 'asClass', extractable: true },
        fatalError: null,
      },
    ],
    exports: [{ exported, local: binding, source: null, original: null }],
  };
}

function factsExtractor(
  overrides: Record<string, FactFile>,
  calls: Array<Array<{ path: string; source: string; hash?: string }>> = []
): SourceIngestionOptions['extractFacts'] {
  return (filesJson) => {
    const entries = JSON.parse(filesJson) as Array<{
      path: string;
      source: string;
      hash?: string;
    }>;
    calls.push(entries);
    return JSON.stringify({
      files: Object.fromEntries(
        entries.map((entry) => [
          entry.path,
          overrides[entry.path] ?? emptyFacts(entry.path),
        ])
      ),
      parseCount: entries.length,
    } satisfies ExtractFactsResult);
  };
}

describe('ingestSourceEntries', () => {
  test('preserves native and MDX original identity separately from parser entries', async () => {
    const mdxSource = `import { Badge } from './definition';\n\n<Badge tone="quiet" />`;
    const rawEntries = [
      {
        path: 'src/definition.ts',
        source: `export const badge = ds.styles({}).asClass();`,
      },
      { path: 'src/usage.mdx', source: mdxSource },
    ];
    const calls: Array<Array<{ path: string; source: string }>> = [];
    let svelteAdaptCount = 0;

    const result = await ingestSourceEntries(rawEntries, {
      extractFacts: factsExtractor({}, calls),
      preprocessMdx,
      adaptSvelte: async (...args) => {
        svelteAdaptCount += 1;
        return adaptSvelteSource(...args);
      },
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.originalEntries).toEqual([
      { ...rawEntries[0], hash: contentHash(rawEntries[0].source) },
      { ...rawEntries[1], hash: contentHash(rawEntries[1].source) },
    ]);
    expect(result.analysisEntries.map((entry) => entry.path)).toEqual([
      'src/definition.ts',
      'src/usage.mdx.tsx',
    ]);
    expect(result.analysisEntries[1].source).toContain(
      '/* @mdx-source: src/usage.mdx */'
    );
    expect(result.analysisEntries[1].hash).toBe(
      contentHash(result.analysisEntries[1].source)
    );
    expect(result.ownership).toEqual({
      'src/definition.ts': {
        originalPath: 'src/definition.ts',
        originalHash: contentHash(rawEntries[0].source),
        analysisPaths: ['src/definition.ts'],
      },
      'src/usage.mdx': {
        originalPath: 'src/usage.mdx',
        originalHash: contentHash(mdxSource),
        analysisPaths: ['src/usage.mdx.tsx'],
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].map((entry) => entry.path)).toEqual([
      'src/definition.ts',
      'src/usage.mdx.tsx',
    ]);
    expect(svelteAdaptCount).toBe(0);
  });

  test('attributes local import aliases and same-name re-exports with one Svelte parse and multi-entry ownership', async () => {
    const definitionPath = 'external/pkg/src/definition.ts';
    const barrelPath = 'external/pkg/src/barrel.ts';
    const sveltePath = 'external/pkg/src/Usage.svelte';
    const svelteSource = `<script context="module">
import { badge as moduleCard } from './barrel';
const moduleAttrs = moduleCard.attrs();
</script>
<script>
import { badge as localBadge } from './definition';
const attrs = localBadge.attrs({ tone: 'quiet' });
</script>`;
    const barrelFacts: FactFile = {
      ...emptyFacts(barrelPath),
      exports: [
        {
          exported: 'badge',
          local: null,
          source: './definition',
          original: 'badge',
        },
      ],
    };
    let adaptCount = 0;

    const result = await ingestSourceEntries(
      [
        {
          path: definitionPath,
          source: `export const badge = ds.styles({}).asClass();`,
        },
        {
          path: barrelPath,
          source: `export { badge } from './definition';`,
        },
        { path: sveltePath, source: svelteSource },
      ],
      {
        extractFacts: factsExtractor({
          [definitionPath]: resolverFacts(definitionPath),
          [barrelPath]: barrelFacts,
        }),
        adaptSvelte: async (...args) => {
          adaptCount += 1;
          return adaptSvelteSource(...args);
        },
      }
    );

    expect(result.diagnostics).toEqual([]);
    expect(adaptCount).toBe(1);
    expect(result.ownership[sveltePath]).toEqual({
      originalPath: sveltePath,
      originalHash: contentHash(svelteSource),
      analysisPaths: [`${sveltePath}.module.tsx`, `${sveltePath}.instance.tsx`],
    });
    expect(
      result.analysisEntries.find(
        (entry) => entry.path === `${sveltePath}.module.tsx`
      )?.source
    ).toContain('<moduleCard />');
    expect(
      result.analysisEntries.find(
        (entry) => entry.path === `${sveltePath}.instance.tsx`
      )?.source
    ).toContain("<localBadge tone={'quiet'} />");
  });

  test('resolves NodeNext-style relative specifiers carrying the emitted extension', async () => {
    const definitionPath = 'src/definition.ts';
    const sveltePath = 'src/Usage.svelte';
    // `moduleResolution: nodenext` consumers MUST write `./definition.js`
    // for a `definition.ts` neighbor; the probe maps the emitted extension
    // back to its source forms instead of classifying the import 'other'.
    const svelteSource = `<script>
import { badge } from './definition.js';
const attrs = badge.attrs({ tone: 'quiet' });
</script>`;

    const result = await ingestSourceEntries(
      [
        {
          path: definitionPath,
          source: `export const badge = ds.styles({}).asClass();`,
        },
        { path: sveltePath, source: svelteSource },
      ],
      {
        extractFacts: factsExtractor({
          [definitionPath]: resolverFacts(definitionPath),
        }),
      }
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.ownership[sveltePath].analysisPaths).toEqual([
      `${sveltePath}.instance.tsx`,
    ]);
    expect(
      result.analysisEntries.find(
        (entry) => entry.path === `${sveltePath}.instance.tsx`
      )?.source
    ).toContain("<badge tone={'quiet'} />");
  });

  test('attributes Windows-style source keys without rewriting public identities', async () => {
    const definitionPath = 'src\\definition.ts';
    const usagePath = 'src\\Usage.svelte';
    const usageSource = `<script>
import { badge } from './definition';
let gap = '13px';
const attrs = badge.attrs({ gap });
</script>`;
    const rawEntries = [
      {
        path: definitionPath,
        source: `export const badge = ds.styles({}).props({ gap: { property: 'gap' } }).asClass();`,
      },
      { path: usagePath, source: usageSource },
    ];

    const result = await ingestSourceEntries(rawEntries, {
      extractFacts: factsExtractor({
        [definitionPath]: resolverFacts(definitionPath),
      }),
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.originalEntries).toEqual(
      rawEntries.map((entry) => ({
        ...entry,
        hash: contentHash(entry.source),
      }))
    );
    expect(result.ownership).toEqual({
      [definitionPath]: {
        originalPath: definitionPath,
        originalHash: contentHash(rawEntries[0].source),
        analysisPaths: [definitionPath],
      },
      [usagePath]: {
        originalPath: usagePath,
        originalHash: contentHash(usageSource),
        analysisPaths: [`${usagePath}.instance.tsx`],
      },
    });
    expect(result.analysisEntries.map((entry) => entry.path)).toEqual([
      definitionPath,
      `${usagePath}.instance.tsx`,
    ]);
    expect(result.analysisEntries[1].source).toContain('gap={gap}');
  });

  test('fails loud when distinct source keys collide in the private resolver identity', async () => {
    const windowsPath = 'src\\definition.ts';
    const posixPath = 'src/definition.ts';
    const usagePath = 'src\\Usage.svelte';
    const source = `export const badge = ds.styles({}).asClass();`;

    const result = await ingestSourceEntries(
      [
        { path: windowsPath, source },
        { path: posixPath, source },
        {
          path: usagePath,
          source: `<script>import { badge } from './definition'; const attrs = badge.attrs();</script>`,
        },
      ],
      {
        extractFacts: factsExtractor({
          [windowsPath]: resolverFacts(windowsPath),
          [posixPath]: resolverFacts(posixPath),
        }),
      }
    );

    expect(result.diagnostics).toEqual([
      {
        code: 'SOURCE_RESOLVER_IDENTITY_COLLISION',
        message: `Resolver lookup paths '${windowsPath}' and '${posixPath}' normalize to the same private identity '${posixPath}'. Rename one of the source files so resolver identities remain unique.`,
        originalPath: windowsPath,
        canonicalPath: posixPath,
        conflictingOriginalPath: posixPath,
      },
      {
        code: 'SOURCE_RESOLVER_IDENTITY_COLLISION',
        message: `Resolver lookup paths '${posixPath}' and '${windowsPath}' normalize to the same private identity '${posixPath}'. Rename one of the source files so resolver identities remain unique.`,
        originalPath: posixPath,
        canonicalPath: posixPath,
        conflictingOriginalPath: windowsPath,
      },
    ]);
    expect(result.originalEntries.map((entry) => entry.path)).toEqual([
      windowsPath,
      posixPath,
      usagePath,
    ]);
    expect(result.analysisEntries.map((entry) => entry.path)).toEqual([
      windowsPath,
      posixPath,
    ]);
    expect(result.ownership[usagePath].analysisPaths).toEqual([]);
  });

  test('attributes a same-name import-then-local-export barrel', async () => {
    const definitionPath = 'src/definition.ts';
    const barrelPath = 'src/barrel.ts';
    const usagePath = 'src/Usage.svelte';
    const usageSource = `<script>
import { badge } from './barrel';
const attrs = badge.attrs({ tone: 'quiet' });
</script>`;

    const result = await ingestSourceEntries(
      [
        {
          path: definitionPath,
          source: `export const badge = ds.styles({}).asClass();`,
        },
        {
          path: barrelPath,
          source: `import { badge } from './definition'; export { badge };`,
        },
        { path: usagePath, source: usageSource },
      ],
      {
        extractFacts: factsExtractor({
          [definitionPath]: resolverFacts(definitionPath),
          [barrelPath]: {
            ...emptyFacts(barrelPath),
            imports: [
              {
                local: 'badge',
                imported: 'badge',
                source: './definition',
              },
            ],
            exports: [
              {
                exported: 'badge',
                local: 'badge',
                source: null,
                original: null,
              },
            ],
          },
        }),
      }
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.ownership[usagePath].analysisPaths).toEqual([
      `${usagePath}.instance.tsx`,
    ]);
  });

  test.each([
    [
      'a sourced re-export alias',
      {
        imports: [],
        exported: {
          exported: 'pill',
          local: null,
          source: './definition',
          original: 'badge',
        },
      },
    ],
    [
      'an import-then-local-export alias',
      {
        imports: [
          { local: 'badge', imported: 'badge', source: './definition' },
        ],
        exported: {
          exported: 'pill',
          local: 'badge',
          source: null,
          original: null,
        },
      },
    ],
  ])(
    'fails closed for %s that reaches an actual resolver',
    async (_label, barrel) => {
      const definitionPath = 'src/definition.ts';
      const barrelPath = 'src/barrel.ts';
      const usagePath = 'src/Usage.svelte';
      const result = await ingestSourceEntries(
        [
          {
            path: definitionPath,
            source: `export const badge = ds.styles({}).asClass();`,
          },
          {
            path: barrelPath,
            source: `export const fixture = true;`,
          },
          {
            path: usagePath,
            source: `<script>import { pill } from './barrel'; const attrs = pill.attrs({ tone: 'quiet' });</script>`,
          },
        ],
        {
          extractFacts: factsExtractor({
            [definitionPath]: resolverFacts(definitionPath),
            [barrelPath]: {
              ...emptyFacts(barrelPath),
              imports: barrel.imports,
              exports: [barrel.exported],
            },
          }),
        }
      );

      expect(result.diagnostics).toEqual([
        expect.objectContaining({
          code: 'SVELTE_ATTRS_IMPORT_UNSUPPORTED',
          originalPath: usagePath,
        }),
      ]);
      expect(result.ownership[usagePath].analysisPaths).toEqual([]);
    }
  );

  test('ignores unrelated and unresolved non-relative attrs access', async () => {
    const source = `<script>
import { schema } from '@app/schema';
const attrs = schema.attrs({ ...props });
</script>`;
    const result = await ingestSourceEntries(
      [{ path: 'src/Unrelated.svelte', source }],
      { extractFacts: factsExtractor({}) }
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.analysisEntries).toEqual([]);
    expect(result.ownership['src/Unrelated.svelte'].analysisPaths).toEqual([]);
  });

  test('fails closed only after an unsupported access resolves to an asClass export', async () => {
    const definitionPath = 'src/definition.ts';
    const source = `<script>
import * as styles from './definition';
const attrs = styles.badge.attrs({ tone: 'quiet' });
</script>`;
    const result = await ingestSourceEntries(
      [
        {
          path: definitionPath,
          source: `export const badge = ds.styles({}).asClass();`,
        },
        { path: 'src/Unsupported.svelte', source },
      ],
      {
        extractFacts: factsExtractor({
          [definitionPath]: resolverFacts(definitionPath),
        }),
      }
    );

    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'SVELTE_ATTRS_IMPORT_UNSUPPORTED',
        originalPath: 'src/Unsupported.svelte',
      }),
    ]);
    expect(result.analysisEntries.map((entry) => entry.path)).toEqual([
      definitionPath,
    ]);
    expect(result.ownership['src/Unsupported.svelte'].analysisPaths).toEqual(
      []
    );
  });

  test.each([
    ['an unextractable descriptor', { extractable: false, fatalError: null }],
    ['a fatal chain', { extractable: true, fatalError: 'stage failed' }],
  ])('does not attribute %s as a resolver', async (_label, viability) => {
    const definitionPath = 'src/definition.ts';
    const facts = resolverFacts(definitionPath);
    Object.assign(facts.chains[0].descriptor, {
      extractable: viability.extractable,
    });
    facts.chains[0].fatalError = viability.fatalError;
    const source = `<script>
import { badge } from './definition';
const attrs = badge.attrs(props);
</script>`;

    const result = await ingestSourceEntries(
      [
        {
          path: definitionPath,
          source: `export const badge = ds.styles({}).asClass();`,
        },
        { path: 'src/Dropped.svelte', source },
      ],
      { extractFacts: factsExtractor({ [definitionPath]: facts }) }
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.analysisEntries.map((entry) => entry.path)).toEqual([
      definitionPath,
    ]);
    expect(result.ownership['src/Dropped.svelte'].analysisPaths).toEqual([]);
  });

  test('maps native diagnostics from generated entries back to the original owner', async () => {
    const source = '# Usage';
    const result = await ingestSourceEntries(
      [{ path: 'src/broken.mdx', source }],
      {
        extractFacts: factsExtractor({
          'src/broken.mdx.tsx': {
            ...emptyFacts('src/broken.mdx.tsx'),
            parseDiagnostics: ['unexpected token'],
          },
        }),
      }
    );

    expect(result.diagnostics).toEqual([
      {
        code: 'SOURCE_NATIVE_PARSE_ERROR',
        message: 'unexpected token',
        originalPath: 'src/broken.mdx',
        analysisPath: 'src/broken.mdx.tsx',
      },
    ]);
  });

  test('rejects a Svelte owner atomically when one of its generated paths collides with a physical source', async () => {
    const definitionPath = 'src/definition.ts';
    const sveltePath = 'src/Foo.svelte';
    const physicalPath = `${sveltePath}.instance.tsx`;
    const physicalSource = `export const physical = true;`;
    const svelteSource = `<script context="module">
import { badge } from './definition';
const moduleAttrs = badge.attrs();
</script>
<script>
import { badge } from './definition';
const attrs = badge.attrs();
</script>`;

    const result = await ingestSourceEntries(
      [
        {
          path: definitionPath,
          source: `export const badge = ds.styles({}).asClass();`,
        },
        { path: physicalPath, source: physicalSource },
        { path: sveltePath, source: svelteSource },
      ],
      {
        extractFacts: factsExtractor({
          [definitionPath]: resolverFacts(definitionPath),
        }),
      }
    );

    expect(result.diagnostics).toEqual([
      {
        code: 'SOURCE_ANALYSIS_PATH_COLLISION',
        message: `Generated analysis path '${physicalPath}' collides with '${physicalPath}'. Rename one of the source files so adapted analysis paths remain unique.`,
        originalPath: sveltePath,
        analysisPath: physicalPath,
        conflictingOriginalPath: physicalPath,
      },
    ]);
    expect(result.analysisEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: definitionPath }),
        {
          path: physicalPath,
          source: physicalSource,
          hash: contentHash(physicalSource),
        },
      ])
    );
    expect(result.analysisEntries.map((entry) => entry.path)).not.toContain(
      `${sveltePath}.module.tsx`
    );
    expect(
      result.analysisEntries.filter((entry) => entry.path === physicalPath)
    ).toHaveLength(1);
    expect(result.ownership[physicalPath].analysisPaths).toEqual([
      physicalPath,
    ]);
    expect(result.ownership[sveltePath].analysisPaths).toEqual([]);
  });

  test('rejects an MDX owner when its generated path collides with a physical source', async () => {
    const mdxPath = 'src/usage.mdx';
    const physicalPath = `${mdxPath}.tsx`;
    const physicalSource = `export const physical = true;`;

    const result = await ingestSourceEntries(
      [
        { path: mdxPath, source: '# Usage' },
        { path: physicalPath, source: physicalSource },
      ],
      { extractFacts: factsExtractor({}) }
    );

    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'SOURCE_ANALYSIS_PATH_COLLISION',
        originalPath: mdxPath,
        analysisPath: physicalPath,
        conflictingOriginalPath: physicalPath,
      }),
    ]);
    expect(result.analysisEntries).toEqual([
      {
        path: physicalPath,
        source: physicalSource,
        hash: contentHash(physicalSource),
      },
    ]);
    expect(result.ownership[physicalPath].analysisPaths).toEqual([
      physicalPath,
    ]);
    expect(result.ownership[mdxPath].analysisPaths).toEqual([]);
  });
});
