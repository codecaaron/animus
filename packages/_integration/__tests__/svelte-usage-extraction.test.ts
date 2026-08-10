import {
  adaptSvelteSource,
  type AdaptSvelteSourceOptions,
} from '@animus-ui/extract/pipeline';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, test } from 'vitest';

import { runPipeline } from './run-pipeline';

const FIXTURES_ROOT = join(__dirname, '..', 'fixtures');
const FIXTURE_DIR = join(FIXTURES_ROOT, 'components', 'svelte-usage');

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

function usageTags(fileFacts: { usage: unknown[] }): string[] {
  return fileFacts.usage.flatMap((fact) => {
    const element = (fact as { element?: { tag?: { ident?: string } } })
      .element;
    return element?.tag?.ident ? [element.tag.ident] : [];
  });
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

  test('dynamic shorthand retains every option and binding-specific residue', async () => {
    const usageEntry = await projectFixture('dynamic.svelte');
    const { manifest, css } = runPipeline([definitionEntry, usageEntry]);
    const fileFacts = manifest.fileFacts[usageEntry.path];
    const badgeComponent = Object.values(manifest.components).find(
      (component) => (component as { binding?: string }).binding === 'badge'
    ) as { replacement: string; system_prop_names: string[] } | undefined;

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
