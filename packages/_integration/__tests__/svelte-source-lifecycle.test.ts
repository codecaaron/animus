import {
  contentHash,
  ingestSourceEntries,
  type SourceIngestionResult,
} from '@animus-ui/extract/pipeline';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import { runPipeline } from './run-pipeline';
import { usageTags, type UsageFactRecord } from './usage-facts';

interface RawEntry {
  path: string;
  source: string;
}

interface Publication {
  ingestion: SourceIngestionResult;
  manifest: {
    css: string;
    fileFacts: Record<string, { usage: UsageFactRecord[] }>;
    usageResidue: Array<{
      binding: string;
      prop: string;
      file: string;
      kind: string;
    }>;
  };
}

const FIXTURE_ROOT = join(
  __dirname,
  '..',
  'fixtures',
  'components',
  'svelte-lifecycle'
);
const LOCAL_DEFINITION = 'app/src/definition.ts';
const LOCAL_USAGE = 'app/src/usage.svelte';
const LOCAL_CHILD = `${LOCAL_USAGE}.instance.tsx`;
const EXTERNAL_DEFINITION = '../external/pkg/src/definition.ts';
const EXTERNAL_USAGE = '../external/pkg/src/usage.svelte';
const EXTERNAL_CHILD = `${EXTERNAL_USAGE}.instance.tsx`;

function fixture(relativePath: string, path: string = relativePath): RawEntry {
  return {
    path,
    source: readFileSync(join(FIXTURE_ROOT, relativePath), 'utf8'),
  };
}

function extractFacts(filesJson: string): string {
  const entries = JSON.parse(filesJson) as RawEntry[];
  const { manifest } = runPipeline(entries);
  return JSON.stringify({
    files: manifest.fileFacts,
    parseCount: entries.length,
  });
}

class RawSourceLifecycle {
  private readonly rawEntries = new Map<string, RawEntry>();

  publication: Publication | null = null;

  constructor(entries: RawEntry[]) {
    for (const entry of entries) this.rawEntries.set(entry.path, entry);
  }

  update(entry: RawEntry): void {
    this.rawEntries.set(entry.path, entry);
  }

  delete(path: string): void {
    this.rawEntries.delete(path);
  }

  async publish(): Promise<Publication> {
    const ingestion = await ingestSourceEntries([...this.rawEntries.values()], {
      extractFacts,
    });
    if (ingestion.diagnostics.length > 0) {
      throw new Error(JSON.stringify(ingestion.diagnostics));
    }
    const { manifest } = runPipeline(ingestion.analysisEntries);
    this.publication = { ingestion, manifest } as Publication;
    return this.publication;
  }

  reset(): Promise<Publication> {
    return this.publish();
  }
}

function projectionReceipt(publication: Publication) {
  return {
    entries: publication.ingestion.analysisEntries.map((entry) => ({
      path: entry.path,
      hash: entry.hash,
    })),
    ownership: publication.ingestion.ownership,
    css: publication.manifest.css,
    fileFacts: Object.fromEntries(
      Object.entries(publication.manifest.fileFacts).map(([path, facts]) => [
        path,
        usageTags(facts),
      ])
    ),
    usageResidue: publication.manifest.usageResidue,
  };
}

async function barrelReceipt(barrelSource: string, imported: 'badge' | 'pill') {
  const definition = {
    path: 'barrel/definition.ts',
    source:
      "export const badge = ds.styles({}).props({ gap: { property: 'gap' } }).asClass();",
  };
  const barrel = { path: 'barrel/index.ts', source: barrelSource };
  const usage = {
    path: 'barrel/Usage.svelte',
    source: `<script lang="ts">
  import { ${imported} } from './index';
  let { gap }: { gap: string } = $props();
  const attrs = $derived(${imported}.attrs({ gap }));
</script>`,
  };
  const ingestion = await ingestSourceEntries([definition, barrel, usage], {
    extractFacts,
  });
  const { manifest } = runPipeline(ingestion.analysisEntries);

  return {
    diagnosticCodes: ingestion.diagnostics.map((diagnostic) => diagnostic.code),
    analysisPaths: ingestion.ownership[usage.path].analysisPaths,
    residue: manifest.usageResidue,
    dynamicGapCss: /gap:\s*var\(--animus-gap\)/.test(manifest.css),
  };
}

describe('real-engine Svelte source lifecycle', () => {
  test('retains dynamic residue for Windows-style source keys without rewriting ownership', async () => {
    const definitionPath = 'windows\\src\\definition.ts';
    const usagePath = 'windows\\src\\Usage.svelte';
    const childPath = `${usagePath}.instance.tsx`;
    const definitionSource =
      "export const badge = ds.styles({ display: 'flex' }).props({ gap: { property: 'gap' } }).asClass();";
    const usageSource = `<script lang="ts">
  import { badge } from './definition';
  let { gap }: { gap: string } = $props();
  const attrs = $derived(badge.attrs({ gap }));
</script>`;

    const ingestion = await ingestSourceEntries(
      [
        { path: definitionPath, source: definitionSource },
        { path: usagePath, source: usageSource },
      ],
      { extractFacts }
    );
    const { manifest } = runPipeline(ingestion.analysisEntries);

    expect(ingestion.diagnostics).toEqual([]);
    expect(ingestion.originalEntries.map((entry) => entry.path)).toEqual([
      definitionPath,
      usagePath,
    ]);
    expect(ingestion.ownership).toEqual({
      [definitionPath]: {
        originalPath: definitionPath,
        originalHash: contentHash(definitionSource),
        analysisPaths: [definitionPath],
      },
      [usagePath]: {
        originalPath: usagePath,
        originalHash: contentHash(usageSource),
        analysisPaths: [childPath],
      },
    });
    expect(manifest.usageResidue).toContainEqual(
      expect.objectContaining({
        binding: 'badge',
        prop: 'gap',
        kind: 'identifier',
      })
    );
    expect(manifest.css).toMatch(/gap:\s*var\(--animus-gap\)/);
  });

  test('keeps raw ownership and analysis projection equivalent across the lifecycle', async () => {
    const definition = fixture('app/src/definition.ts', LOCAL_DEFINITION);
    const literal = fixture('app/src/literal.svelte', LOCAL_USAGE);
    const dynamic = fixture('app/src/dynamic.svelte', LOCAL_USAGE);
    const externalDefinition = fixture(
      'external/pkg/src/definition.ts',
      EXTERNAL_DEFINITION
    );
    const externalUsage = fixture(
      'external/pkg/src/usage.svelte',
      EXTERNAL_USAGE
    );
    const lifecycle = new RawSourceLifecycle([
      definition,
      literal,
      externalDefinition,
      externalUsage,
    ]);

    const initial = await lifecycle.publish();
    expect(initial.ingestion.originalEntries).toContainEqual({
      ...literal,
      hash: contentHash(literal.source),
    });
    expect(initial.ingestion.ownership[LOCAL_USAGE].analysisPaths).toEqual([
      LOCAL_CHILD,
    ]);
    expect(
      initial.ingestion.analysisEntries.map((entry) => entry.path)
    ).not.toContain(LOCAL_USAGE);
    expect(initial.ingestion.ownership[EXTERNAL_USAGE]).toEqual({
      originalPath: EXTERNAL_USAGE,
      originalHash: contentHash(externalUsage.source),
      analysisPaths: [EXTERNAL_CHILD],
    });
    expect(usageTags(initial.manifest.fileFacts[LOCAL_CHILD])).toEqual([
      'badge',
    ]);
    expect(usageTags(initial.manifest.fileFacts[EXTERNAL_CHILD])).toEqual([
      'banner',
    ]);
    expect(initial.manifest.css).toContain('--tone-quiet');
    expect(initial.manifest.css).not.toContain('--tone-loud');
    expect(initial.manifest.css).toContain('--density-compact');
    expect(initial.manifest.css).not.toContain('--density-spacious');

    lifecycle.update(dynamic);
    const updated = await lifecycle.publish();
    expect(updated.ingestion.ownership[LOCAL_USAGE].originalHash).toBe(
      contentHash(dynamic.source)
    );
    expect(updated.ingestion.ownership[LOCAL_USAGE].analysisPaths).toEqual([
      LOCAL_CHILD,
    ]);
    expect(updated.manifest.css).toContain('--tone-quiet');
    expect(updated.manifest.css).toContain('--tone-loud');
    expect(updated.manifest.css).toContain('--tone-urgent');
    expect(updated.manifest.usageResidue).toContainEqual(
      expect.objectContaining({
        binding: 'badge',
        prop: 'gap',
        file: LOCAL_CHILD,
        kind: 'identifier',
      })
    );

    lifecycle.delete(LOCAL_USAGE);
    const deleted = await lifecycle.publish();
    expect(deleted.ingestion.ownership).not.toHaveProperty(LOCAL_USAGE);
    expect(
      deleted.ingestion.analysisEntries.map((entry) => entry.path)
    ).not.toContain(LOCAL_CHILD);
    expect(deleted.manifest.fileFacts).not.toHaveProperty(LOCAL_CHILD);
    expect(deleted.ingestion.ownership[EXTERNAL_USAGE].analysisPaths).toEqual([
      EXTERNAL_CHILD,
    ]);

    const deletedReset = await lifecycle.reset();
    expect(projectionReceipt(deletedReset)).toEqual(projectionReceipt(deleted));
    expect(deletedReset.ingestion.ownership).not.toHaveProperty(LOCAL_USAGE);
    expect(deletedReset.manifest.fileFacts).not.toHaveProperty(LOCAL_CHILD);

    lifecycle.update(literal);
    const recreated = await lifecycle.publish();
    expect(recreated.ingestion.ownership[LOCAL_USAGE]).toEqual({
      originalPath: LOCAL_USAGE,
      originalHash: contentHash(literal.source),
      analysisPaths: [LOCAL_CHILD],
    });
    expect(usageTags(recreated.manifest.fileFacts[LOCAL_CHILD])).toEqual([
      'badge',
    ]);

    const recreatedReceipt = projectionReceipt(recreated);
    expect(projectionReceipt(await lifecycle.reset())).toEqual(
      recreatedReceipt
    );
  });

  test.each([
    ['sourced re-export', "export { badge } from './definition';"],
    [
      'import-then-local-export barrel',
      "import { badge } from './definition'; export { badge };",
    ],
  ])(
    'retains dynamic residue through a same-name %s',
    async (_label, barrelSource) => {
      const receipt = await barrelReceipt(barrelSource, 'badge');

      expect(receipt).toEqual({
        diagnosticCodes: [],
        analysisPaths: ['barrel/Usage.svelte.instance.tsx'],
        residue: [
          expect.objectContaining({
            binding: 'badge',
            prop: 'gap',
            file: 'barrel/Usage.svelte.instance.tsx',
            kind: 'identifier',
          }),
        ],
        dynamicGapCss: true,
      });
    }
  );

  test.each([
    ['sourced re-export', "export { badge as pill } from './definition';"],
    [
      'import-then-local-export barrel',
      "import { badge } from './definition'; export { badge as pill };",
    ],
  ])(
    'witnesses an aliased %s — engine usage identity follows renamed chains',
    async (_label, barrelSource) => {
      // Formerly fail-closed: the engine could not attribute usage through
      // a renamed hop, so witnessing would have under-emitted. Usage
      // identity now walks sourced re-exports, local renames, and
      // import-then-local-export barrels to the defining chain, so the
      // renamed consumer behaves exactly like the same-name cases above.
      const receipt = await barrelReceipt(barrelSource, 'pill');

      expect(receipt).toEqual({
        diagnosticCodes: [],
        analysisPaths: ['barrel/Usage.svelte.instance.tsx'],
        residue: [
          expect.objectContaining({
            binding: 'badge',
            prop: 'gap',
            file: 'barrel/Usage.svelte.instance.tsx',
            kind: 'identifier',
          }),
        ],
        dynamicGapCss: true,
      });
    }
  );
});
