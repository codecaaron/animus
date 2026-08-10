import { parseSync } from 'oxc-parser';
import { describe, expect, test } from 'vitest';

import { adaptSvelteSource } from '../pipeline/svelte-source-adapter';

const resolverOptions = {
  attributeResolver: ({
    source,
    imported,
    access,
  }: {
    source: string;
    imported: string;
    access: { importKind: string; kind: string };
  }) => {
    const supported =
      access.kind === 'direct' &&
      access.importKind === 'named' &&
      ((source === './module-badge' && imported === 'moduleBadge') ||
        (source === './badge' && imported === 'badge'));
    return supported ? ('resolver' as const) : ('other' as const);
  },
};

const SOURCE = `<script context="module">
import { moduleBadge } from './module-badge';
import { moduleHelper } from './module-helper';
const moduleAttrs = moduleBadge.attrs({ tone: 'quiet' });
</script>

<script lang="ts">
import { badge, badge as badgeAlias, ignored } from './badge';
import { helper } from './helper';
export let label: string;
const baseAttrs = badge.attrs();
const dynamicAttrs = badgeAlias.attrs({ tone: 'strong', active, size: width + 1 });
</script>

<Wrapper {...dynamicAttrs}>{label}</Wrapper>
`;

async function okResult() {
  const result = await adaptSvelteSource(
    SOURCE,
    'src/Badge.svelte',
    resolverOptions
  );
  expect(result.kind).toBe('ok');
  if (result.kind !== 'ok') throw new Error(`expected ok, got ${result.kind}`);
  return result;
}

describe('adaptSvelteSource', () => {
  test('projects module and instance scripts independently', async () => {
    const result = await okResult();

    expect(result.entries.map(({ scope, path }) => ({ scope, path }))).toEqual([
      {
        scope: 'module',
        path: 'src/Badge.svelte.module.tsx',
      },
      {
        scope: 'instance',
        path: 'src/Badge.svelte.instance.tsx',
      },
    ]);

    const moduleEntry = result.entries[0];
    const instanceEntry = result.entries[1];
    expect(moduleEntry.source).toBe(
      "import { moduleBadge } from './module-badge';\n<moduleBadge tone={'quiet'} />;\n"
    );
    expect(instanceEntry.source).toBe(
      "import { badge, badge as badgeAlias } from './badge';\n<badge />;\n<badgeAlias tone={'strong'} active={active} size={width + 1} />;\n"
    );

    expect(moduleEntry.source).not.toContain('moduleHelper');
    expect(instanceEntry.source).not.toContain("from './helper'");
    expect(instanceEntry.source).not.toContain('export let');
  });

  test('supports direct named and aliased imported resolver bindings', async () => {
    const result = await okResult();
    const source = result.entries.map((entry) => entry.source).join('\n');

    expect(source).toContain('<moduleBadge');
    expect(source).toContain('<badge');
    expect(source).toContain('<badgeAlias');
  });

  test('emits absent, literal, shorthand, and dynamic-expression props', async () => {
    const result = await okResult();
    const instanceSource = result.entries[1].source;

    expect(instanceSource).toContain('<badge />');
    expect(instanceSource).toContain("tone={'strong'}");
    expect(instanceSource).toContain('active={active}');
    expect(instanceSource).toContain('size={width + 1}');
  });

  test('does not manufacture exports or scan wrapper component tags', async () => {
    const result = await okResult();
    const source = result.entries.map((entry) => entry.source).join('\n');

    expect(source).not.toMatch(/\bexport\b/);
    expect(source).not.toContain('Wrapper');
    expect(source).not.toContain('dynamicAttrs');
  });

  test('returns no entries when neither script scope witnesses a resolver', async () => {
    const result = await adaptSvelteSource(
      `<script>import { helper } from './helper'; helper();</script><Widget />`,
      'Empty.svelte',
      resolverOptions
    );

    expect(result).toMatchObject({ kind: 'ok', entries: [] });
  });

  test('fails closed when a nested lexical scope can shadow an imported resolver', async () => {
    const result = await adaptSvelteSource(
      `<script>
import { badge } from './badge';
function render() {
  const badge = localResolver;
  return badge.attrs({ tone: 'quiet' });
}
</script>`,
      'Shadowed.svelte',
      resolverOptions
    );

    expect(result).toMatchObject({
      kind: 'error',
      diagnostics: [
        {
          code: 'SVELTE_ATTRS_SCOPE_UNSUPPORTED',
          originalPath: 'Shadowed.svelte',
        },
      ],
    });
  });

  test('is deterministic for identical source identity', async () => {
    expect(
      await adaptSvelteSource(SOURCE, 'src/Badge.svelte', resolverOptions)
    ).toEqual(
      await adaptSvelteSource(SOURCE, 'src/Badge.svelte', resolverOptions)
    );
  });

  test('ignores unrelated direct and namespace-member .attrs() calls', async () => {
    const result = await adaptSvelteSource(
      `<script>
import { schema } from './schema';
import * as validators from './validators';
const direct = schema.attrs(props);
const member = validators.badge.attrs({ ...props });
</script>`,
      'Unrelated.svelte',
      resolverOptions
    );

    expect(result).toMatchObject({ kind: 'ok', entries: [] });
  });

  test('fails closed for an attributed namespace-member resolver form', async () => {
    const requests: unknown[] = [];
    const result = await adaptSvelteSource(
      `<script>
import * as styles from './definition';
const attrs = styles.badge.attrs({ tone: 'quiet' });
</script>`,
      'Namespace.svelte',
      {
        attributeResolver(request: unknown) {
          requests.push(request);
          return 'unsupported-resolver-form';
        },
      }
    );

    expect(requests).toEqual([
      {
        source: './definition',
        imported: 'badge',
        local: 'styles',
        access: { kind: 'namespace-member', importKind: 'namespace' },
      },
    ]);
    expect(result).toMatchObject({
      kind: 'error',
      diagnostics: [{ code: 'SVELTE_ATTRS_IMPORT_UNSUPPORTED' }],
    });
  });

  test('fails closed for an attributed named-default resolver form', async () => {
    const requests: unknown[] = [];
    const result = await adaptSvelteSource(
      `<script>
import { default as localBadge } from './definition';
const attrs = localBadge.attrs();
</script>`,
      'NamedDefault.svelte',
      {
        attributeResolver(request: unknown) {
          requests.push(request);
          return 'unsupported-resolver-form';
        },
      }
    );

    expect(requests).toEqual([
      {
        source: './definition',
        imported: 'default',
        local: 'localBadge',
        access: { kind: 'direct', importKind: 'named-default' },
      },
    ]);
    expect(result).toMatchObject({
      kind: 'error',
      diagnostics: [{ code: 'SVELTE_ATTRS_IMPORT_UNSUPPORTED' }],
    });
  });

  test('attributes the same resolver local independently in both script scopes', async () => {
    const result = await adaptSvelteSource(
      `<script context="module">
import { badge } from './module-definition';
const attrs = badge.attrs({ tone: 'module' });
</script>
<script>
import { badge } from './definition';
const attrs = badge.attrs({ tone: 'instance' });
</script>`,
      'SameLocal.svelte',
      {
        attributeResolver({ source, imported }) {
          return imported === 'badge' &&
            (source === './module-definition' || source === './definition')
            ? 'resolver'
            : 'other';
        },
      }
    );

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok')
      throw new Error(`expected ok, got ${result.kind}`);
    expect(
      result.entries.map(({ scope, source }) => ({ scope, source }))
    ).toEqual([
      {
        scope: 'module',
        source:
          "import { badge } from './module-definition';\n<badge tone={'module'} />;\n",
      },
      {
        scope: 'instance',
        source:
          "import { badge } from './definition';\n<badge tone={'instance'} />;\n",
      },
    ]);
  });

  test('every accepted virtual entry is parse-clean TSX for OXC', async () => {
    const result = await okResult();

    for (const entry of result.entries) {
      expect(
        parseSync(entry.path, entry.source, { lang: 'tsx' }).errors
      ).toEqual([]);
    }
  });

  test('fails closed for an attributed string-named resolver import', async () => {
    const requests: unknown[] = [];
    const source = `<script>
import { 'badge-resolver' as badge } from './definition';
const attrs = badge.attrs({ tone: 'quiet' });
</script>`;
    const result = await adaptSvelteSource(source, 'StringImport.svelte', {
      attributeResolver(request) {
        requests.push(request);
        return request.source === './definition' &&
          request.imported === 'badge-resolver'
          ? 'unsupported-resolver-form'
          : 'other';
      },
    });

    expect(requests).toEqual([
      {
        source: './definition',
        imported: 'badge-resolver',
        local: 'badge',
        access: { kind: 'direct', importKind: 'string-named' },
      },
    ]);
    expect(result.kind).toBe('error');
    if (result.kind !== 'error') {
      throw new Error(`expected error, got ${result.kind}`);
    }
    const receiverStart = source.indexOf('badge.attrs');
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'SVELTE_ATTRS_IMPORT_UNSUPPORTED',
        span: {
          start: Buffer.byteLength(source.slice(0, receiverStart)),
          end: Buffer.byteLength(source.slice(0, receiverStart + 5)),
        },
        location: {
          start: { line: 3, column: 14 },
          end: { line: 3, column: 19 },
        },
      }),
    ]);
    expect(result).not.toHaveProperty('entries');
  });
});
