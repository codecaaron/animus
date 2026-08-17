import { isJsonObject } from '@animus-ui/assertions';
import {
  adaptSvelteSource,
  type AdaptSvelteSourceOptions,
  ingestSourceEntries,
} from '@animus-ui/extract/pipeline';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, test } from 'vitest';

import { runPipeline } from './run-pipeline';
import { usageTags } from './usage-facts';

import type { JsonObject, JsonValue } from '@animus-ui/assertions';

const FIXTURES_ROOT = join(__dirname, '..', 'fixtures');
const FIXTURE_DIR = join(FIXTURES_ROOT, 'components', 'svelte-usage');

/** The single native-loader surface the barrel-hop case reaches for: the fact
 *  extractor `ingestSourceEntries` drives. Direct-path require per the
 *  _integration NAPI-loading contract (see the package CLAUDE.md). */
interface NativeFactExtractor {
  extractFacts(filesJson: string): string;
}

function fixtureEntry(filename: string) {
  const absolutePath = join(FIXTURE_DIR, filename);
  return {
    path: relative(FIXTURES_ROOT, absolutePath),
    source: readFileSync(absolutePath, 'utf-8'),
  };
}

const definitionEntry = fixtureEntry('definition.ts');
const resolverOptions: AdaptSvelteSourceOptions = {
  attributeResolver({ source, imported, access }) {
    if (source !== './definition' || imported !== 'badge') return 'other';
    return access.kind === 'direct' && access.importKind === 'named'
      ? 'resolver'
      : 'unsupported-resolver-form';
  },
};

async function projectFixture(filename: string) {
  const original = fixtureEntry(filename);
  const result = await adaptSvelteSource(
    original.source,
    original.path,
    resolverOptions
  );
  expect(result.kind).toBe('ok');
  if (result.kind !== 'ok') {
    throw new Error(`expected Svelte projection, received ${result.kind}`);
  }
  expect(result.entries).toHaveLength(1);
  return result.entries[0];
}

describe('isolated native Svelte usage projection', () => {
  test('named alias literal usage prunes unselected variants through the real engine', async () => {
    const usageEntry = await projectFixture('literal.svelte');
    const { manifest, css } = runPipeline([definitionEntry, usageEntry]);
    const fileFacts = manifest.fileFacts[usageEntry.path];

    expect(manifest.report.components_extracted).toBe(1);
    expect(css).toMatch(/\.animus-badge-\w+/);
    expect(css).toContain('--tone-quiet');
    expect(css).not.toContain('--tone-loud');
    expect(css).not.toContain('--tone-urgent');
    expect(fileFacts.imports).toContainEqual({
      local: 'literalBadge',
      imported: 'badge',
      source: './definition',
    });
    expect(usageTags(fileFacts)).toEqual(['literalBadge']);
    expect(fileFacts.exports).toEqual([]);
    expect(fileFacts.parseDiagnostics).toEqual([]);
  });

  test('barrel hops: same-name AND renamed re-exports prune through the real index and engine', async () => {
    // Two-layer proof against the REAL index and REAL engine. The index
    // walk reconciles both barrel shapes to the `.asClass()` binding, and
    // engine usage identity now follows renamed chains too (sourced
    // re-export hops + the defining-module local-rename unwrap), so both
    // consumers witness and prune end-to-end.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nativeEngine: NativeFactExtractor = require('../../extract/index-v2.js');
    const extractFacts = (filesJson: string) =>
      nativeEngine.extractFacts(filesJson);

    // Same-name hop: witnesses, and the engine prunes through the barrel.
    const sameNameIngested = await ingestSourceEntries(
      [
        definitionEntry,
        {
          path: 'components/svelte-usage/barrel.ts',
          source: "export { badge } from './definition';\n",
        },
        {
          path: 'components/svelte-usage/SameName.svelte',
          source: `<script lang="ts">
  import { badge } from './barrel';
  const attrs = badge.attrs({ tone: 'quiet' });
</script>
<span {...attrs}>same name</span>
`,
        },
      ],
      { extractFacts }
    );
    expect(sameNameIngested.diagnostics).toEqual([]);
    const sameName = runPipeline(sameNameIngested.analysisEntries);
    expect(sameName.css).toContain('--tone-quiet');
    expect(sameName.css).not.toContain('--tone-loud');

    // Renamed hop: witnesses, and the engine reconciles the projected
    // usage back through the rename to prune unselected variants.
    const renamedIngested = await ingestSourceEntries(
      [
        definitionEntry,
        {
          path: 'components/svelte-usage/renamed-barrel.ts',
          source: "export { badge as pill } from './definition';\n",
        },
        {
          path: 'components/svelte-usage/Renamed.svelte',
          source: `<script lang="ts">
  import { pill } from './renamed-barrel';
  const attrs = pill.attrs({ tone: 'quiet' });
</script>
<span {...attrs}>renamed</span>
`,
        },
      ],
      { extractFacts }
    );
    expect(renamedIngested.diagnostics).toEqual([]);
    expect(
      renamedIngested.ownership['components/svelte-usage/Renamed.svelte']
        .analysisPaths
    ).toEqual(['components/svelte-usage/Renamed.svelte.instance.tsx']);
    const renamed = runPipeline(renamedIngested.analysisEntries);
    expect(renamed.css).toContain('--tone-quiet');
    expect(renamed.css).not.toContain('--tone-loud');
    expect(renamed.css).not.toContain('--tone-urgent');
  });

  test('dynamic shorthand retains every option and binding-specific residue', async () => {
    const usageEntry = await projectFixture('dynamic.svelte');
    const { manifest, css } = runPipeline([definitionEntry, usageEntry]);
    const fileFacts = manifest.fileFacts[usageEntry.path];
    const badgeComponent = Object.values<JsonValue>(manifest.components).find(
      (component): component is JsonObject =>
        isJsonObject(component) && component.binding === 'badge'
    );

    expect(css).toContain('--tone-quiet');
    expect(css).toContain('--tone-loud');
    expect(css).toContain('--tone-urgent');
    expect(manifest.usageResidue).toEqual([
      expect.objectContaining({
        binding: 'badge',
        prop: 'gap',
        file: usageEntry.path,
        kind: 'identifier',
      }),
    ]);
    expect(badgeComponent?.system_prop_names).toContain('gap');
    expect(badgeComponent?.replacement).toContain(
      '"gap":{"varName":"--animus-gap"'
    );
    expect(css).toMatch(/\.animus-dyn-\w+-gap\s*\{\s*gap: var\(--animus-gap\)/);
    expect(usageTags(fileFacts)).toEqual(['dynamicBadge']);
    expect(fileFacts.exports).toEqual([]);
    expect(fileFacts.parseDiagnostics).toEqual([]);
  });
});
