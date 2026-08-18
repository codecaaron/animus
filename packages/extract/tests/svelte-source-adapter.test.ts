import { parseSync } from 'oxc-parser';
import { describe, expect, test } from 'vitest';

import { adaptSvelteSource } from '../pipeline/svelte-source-adapter';

import type { SvelteResolverAttributionRequest } from '../pipeline/svelte-source-adapter';

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
    // Byte-exact projections: the entry list above fixes the entries, so
    // these two literals pin the whole output — both resolver binding forms
    // (direct named `badge`/`moduleBadge`, aliased `badge as badgeAlias`),
    // all four prop forms (absent `<badge />`, literal `tone={'strong'}`,
    // shorthand `active={active}`, dynamic `size={width + 1}`), and every
    // absence: no manufactured export, no `<Wrapper>` template tag scanned,
    // no `dynamicAttrs` local carried through.
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
    const requests: SvelteResolverAttributionRequest[] = [];
    const result = await adaptSvelteSource(
      `<script>
import * as styles from './definition';
const attrs = styles.badge.attrs({ tone: 'quiet' });
</script>`,
      'Namespace.svelte',
      {
        attributeResolver(request: SvelteResolverAttributionRequest) {
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
    const requests: SvelteResolverAttributionRequest[] = [];
    const result = await adaptSvelteSource(
      `<script>
import { default as localBadge } from './definition';
const attrs = localBadge.attrs();
</script>`,
      'NamedDefault.svelte',
      {
        attributeResolver(request: SvelteResolverAttributionRequest) {
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
    const requests: SvelteResolverAttributionRequest[] = [];
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

  test('witnesses the direct callable string form alongside .attrs()', async () => {
    // `ClassResolver` declares both `(props?) => string` and `.attrs()` —
    // the callable form must witness with identical usage semantics, not
    // silently contribute nothing while another consumer's literal prunes
    // the variant it renders.
    const source = `<script>
import { badge } from './badge';
const a = badge.attrs({ tone: 'quiet' });
const b = badge({ tone: 'strong' });
const c = badge();
</script>`;
    const result = await adaptSvelteSource(
      source,
      'src/Callable.svelte',
      resolverOptions
    );
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error('expected ok');
    const instance = result.entries.find(
      (entry) => entry.scope === 'instance'
    )!;
    expect(instance.source).toContain("<badge tone={'quiet'} />");
    expect(instance.source).toContain("<badge tone={'strong'} />");
    expect(instance.source.match(/<badge /g)).toHaveLength(3);
    expect(
      parseSync(instance.path, instance.source, { lang: 'tsx' }).errors
    ).toEqual([]);
  });

  test('callable form enforces the same argument and access rules as .attrs()', async () => {
    const spread = `<script>
import { badge } from './badge';
const attrs = badge({ ...rest });
</script>`;
    const spreadResult = await adaptSvelteSource(
      spread,
      'src/CallableSpread.svelte',
      resolverOptions
    );
    expect(spreadResult.kind).toBe('error');
    if (spreadResult.kind !== 'error') throw new Error('expected error');
    expect(spreadResult.diagnostics).toEqual([
      expect.objectContaining({ code: 'SVELTE_ATTRS_SPREAD_UNRESOLVED' }),
    ]);

    const namespaceCallable = `<script>
import * as styles from './badge';
const attrs = styles.badge({ tone: 'quiet' });
</script>`;
    const namespaceResult = await adaptSvelteSource(
      namespaceCallable,
      'src/NamespaceCallable.svelte',
      {
        attributeResolver: (request) =>
          request.source === './badge' && request.imported === 'badge'
            ? 'resolver'
            : 'other',
      }
    );
    expect(namespaceResult.kind).toBe('error');
    if (namespaceResult.kind !== 'error') throw new Error('expected error');
    expect(namespaceResult.diagnostics).toEqual([
      expect.objectContaining({ code: 'SVELTE_ATTRS_IMPORT_UNSUPPORTED' }),
    ]);
  });

  test('a module-script import called from the instance script witnesses with its import copied', async () => {
    // Svelte places `<script module>` bindings in scope for the instance
    // script; the projection must carry the module import into the
    // instance entry rather than dropping the call without a witness.
    const source = `<script module>
import { badge } from './badge';
</script>
<script>
const attrs = badge.attrs({ tone: 'quiet' });
</script>`;
    const result = await adaptSvelteSource(
      source,
      'src/CrossScope.svelte',
      resolverOptions
    );
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.entries.map((entry) => entry.scope)).toEqual(['instance']);
    const instance = result.entries[0];
    expect(instance.source).toContain("import { badge } from './badge';");
    expect(instance.source).toContain("<badge tone={'quiet'} />");
    expect(
      parseSync(instance.path, instance.source, { lang: 'tsx' }).errors
    ).toEqual([]);

    // An instance import of the same name shadows the module import and
    // is rendered exactly once.
    const shadowed = `<script module>
import { badge } from './module-other';
</script>
<script>
import { badge } from './badge';
const attrs = badge.attrs({ tone: 'quiet' });
</script>`;
    const shadowResult = await adaptSvelteSource(
      shadowed,
      'src/CrossScopeShadow.svelte',
      resolverOptions
    );
    expect(shadowResult.kind).toBe('ok');
    if (shadowResult.kind !== 'ok') throw new Error('expected ok');
    const shadowInstance = shadowResult.entries[0];
    expect(shadowInstance.source).toContain("import { badge } from './badge';");
    expect(shadowInstance.source).not.toContain('./module-other');
  });

  test('resolver calls written in the template fragment fail closed', async () => {
    const spreadInMarkup = `<script>
import { badge } from './badge';
</script>
<div {...badge.attrs({ tone: 'loud' })}>markup</div>`;
    const result = await adaptSvelteSource(
      spreadInMarkup,
      'src/Template.svelte',
      resolverOptions
    );
    expect(result.kind).toBe('error');
    if (result.kind !== 'error') throw new Error('expected error');
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'SVELTE_ATTRS_TEMPLATE_UNSUPPORTED',
        originalPath: 'src/Template.svelte',
      }),
    ]);

    // The callable form and module-script bindings are covered by the same
    // fragment scan.
    const constInEach = `<script module>
import { badge } from './badge';
</script>
{#each [1] as item}
  {@const attrs = badge({ tone: 'quiet' })}
  <span {...attrs}>{item}</span>
{/each}`;
    const eachResult = await adaptSvelteSource(
      constInEach,
      'src/TemplateEach.svelte',
      resolverOptions
    );
    expect(eachResult.kind).toBe('error');
    if (eachResult.kind !== 'error') throw new Error('expected error');
    expect(eachResult.diagnostics).toEqual([
      expect.objectContaining({ code: 'SVELTE_ATTRS_TEMPLATE_UNSUPPORTED' }),
    ]);

    // Unrelated calls in markup stay ignored.
    const unrelated = `<script>
import { badge } from './badge';
const attrs = badge.attrs({ tone: 'quiet' });
</script>
<span title={String(attrs.class)}>ok</span>`;
    const unrelatedResult = await adaptSvelteSource(
      unrelated,
      'src/TemplateUnrelated.svelte',
      resolverOptions
    );
    expect(unrelatedResult.kind).toBe('ok');
  });
});
