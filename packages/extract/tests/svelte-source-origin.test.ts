import { describe, expect, test } from 'vitest';

import {
  adaptSvelteSource,
  type SourceSpan,
} from '../pipeline/svelte-source-adapter';

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
    if (source !== './badge') return 'other' as const;
    return imported === 'badge' &&
      access.kind === 'direct' &&
      access.importKind === 'named'
      ? ('resolver' as const)
      : ('unsupported-resolver-form' as const);
  },
};

function sliceBytes(source: string, span: SourceSpan): string {
  return Buffer.from(source).subarray(span.start, span.end).toString();
}

function sourcePosition(source: string, characterOffset: number) {
  const lines = source.slice(0, characterOffset).split('\n');
  return { line: lines.length, column: lines.at(-1)!.length };
}

describe('adaptSvelteSource origin mapping', () => {
  test('carries original path/hash and maps resolver, attribute, and value byte spans', async () => {
    const source = `<script>\nimport { badge } from './badge';\nconst attrs = badge.attrs({ tone: 'strøng', active });\n</script>`;
    const result = await adaptSvelteSource(
      source,
      'src/Badge.svelte',
      resolverOptions
    );

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok')
      throw new Error(`expected ok, got ${result.kind}`);
    expect(result.original).toEqual({
      path: 'src/Badge.svelte',
      hash: expect.stringMatching(/^[a-f0-9]{32}$/),
    });

    const entry = result.entries[0];
    const mapped = entry.mappings.map((mapping) => ({
      kind: mapping.kind,
      generated: sliceBytes(entry.source, mapping.generated),
      original: sliceBytes(source, mapping.original),
    }));
    expect(mapped).toEqual([
      { kind: 'resolver', generated: 'badge', original: 'badge' },
      { kind: 'attribute', generated: 'tone', original: 'tone' },
      { kind: 'value', generated: "'strøng'", original: "'strøng'" },
      { kind: 'attribute', generated: 'active', original: 'active' },
      { kind: 'value', generated: 'active', original: 'active' },
    ]);
  });

  test.each([
    {
      label: 'identifier argument',
      importLine: "import { badge } from './badge';",
      call: 'badge.attrs(props)',
      code: 'SVELTE_ATTRS_ARGUMENT_UNRESOLVED',
      marked: 'props',
    },
    {
      label: 'computed key',
      importLine: "import { badge } from './badge';",
      call: "badge.attrs({ [key]: 'strong' })",
      code: 'SVELTE_ATTRS_COMPUTED_KEY',
      marked: "[key]: 'strong'",
    },
    {
      label: 'spread property',
      importLine: "import { badge } from './badge';",
      call: "badge.attrs({ tone: 'strong', ...props })",
      code: 'SVELTE_ATTRS_SPREAD_UNRESOLVED',
      marked: '...props',
    },
    {
      label: 'method property',
      importLine: "import { badge } from './badge';",
      call: "badge.attrs({ tone() { return 'strong'; } })",
      code: 'SVELTE_ATTRS_PROPERTY_UNSUPPORTED',
      marked: "tone() { return 'strong'; }",
    },
    {
      label: 'multiple arguments',
      importLine: "import { badge } from './badge';",
      call: "badge.attrs({ tone: 'strong' }, props)",
      code: 'SVELTE_ATTRS_ARGUMENT_UNRESOLVED',
      marked: "{ tone: 'strong' }, props",
    },
    {
      label: 'default-imported resolver',
      importLine: "import badge from './badge';",
      call: 'badge.attrs()',
      code: 'SVELTE_ATTRS_IMPORT_UNSUPPORTED',
      marked: 'badge',
    },
    {
      label: 'namespace-imported resolver',
      importLine: "import * as badge from './badge';",
      call: 'badge.attrs()',
      code: 'SVELTE_ATTRS_IMPORT_UNSUPPORTED',
      marked: 'badge',
    },
  ])(
    'fails closed with an original-source diagnostic for $label',
    async ({ importLine, call, code, marked }) => {
      const source = `<script>\n${importLine}\nconst attrs = ${call};\n</script>`;
      const result = await adaptSvelteSource(
        source,
        'src/Invalid.svelte',
        resolverOptions
      );

      expect(result.kind).toBe('error');
      if (result.kind !== 'error') {
        throw new Error(`expected error, got ${result.kind}`);
      }
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]).toMatchObject({
        code,
        originalPath: 'src/Invalid.svelte',
        message: expect.any(String),
      });
      expect(result.diagnostics[0].span).toBeDefined();
      expect(sliceBytes(source, result.diagnostics[0].span!)).toBe(marked);
      const markedStart = source.lastIndexOf(marked);
      expect(result.diagnostics[0].location).toEqual({
        start: sourcePosition(source, markedStart),
        end: sourcePosition(source, markedStart + marked.length),
      });
      expect(result).not.toHaveProperty('entries');
    }
  );

  test.each([
    {
      label: 'angle-bracket type assertion',
      value: '<string>tone',
    },
    {
      label: 'generic arrow function',
      value: '<T>(value: T) => value',
    },
  ])('fails closed for TSX-incompatible $label values', async ({ value }) => {
    const source = `<script lang="ts">\nimport { badge } from './badge';\nconst attrs = badge.attrs({ value: ${value} });\n</script>`;
    const result = await adaptSvelteSource(
      source,
      'src/TypeValue.svelte',
      resolverOptions
    );

    expect(result.kind).toBe('error');
    if (result.kind !== 'error') {
      throw new Error(`expected error, got ${result.kind}`);
    }
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      code: 'SVELTE_ATTRS_VALUE_UNSUPPORTED',
      originalPath: 'src/TypeValue.svelte',
      span: expect.any(Object),
      location: expect.any(Object),
    });
    expect(sliceBytes(source, result.diagnostics[0].span!)).toBe(value);
  });

  test('preserves Svelte parse-error byte span and structured location', async () => {
    const source = `<script>\nconst label = 'strøng';\nconst broken = ;\n</script>`;
    const result = await adaptSvelteSource(
      source,
      'src/Malformed.svelte',
      resolverOptions
    );

    expect(result.kind).toBe('error');
    if (result.kind !== 'error') {
      throw new Error(`expected error, got ${result.kind}`);
    }
    const semicolon = source.indexOf(';', source.indexOf('broken'));
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'SVELTE_PARSE_ERROR',
        originalPath: 'src/Malformed.svelte',
        span: {
          start: Buffer.byteLength(source.slice(0, semicolon)),
          end: Buffer.byteLength(source.slice(0, semicolon)),
        },
        location: {
          start: { line: 3, column: 15 },
          end: { line: 3, column: 15 },
        },
      }),
    ]);
  });

  test.each([
    ['CRLF', '\r\n'],
    ['lone CR', '\r'],
    ['line separator', '\u2028'],
    ['paragraph separator', '\u2029'],
  ])('counts %s as one ECMAScript line terminator', async (_label, newline) => {
    const source = `<script>${newline}import { badge } from './badge';${newline}const attrs = badge.attrs(props);${newline}</script>`;
    const result = await adaptSvelteSource(
      source,
      'src/LineTerminators.svelte',
      resolverOptions
    );

    expect(result.kind).toBe('error');
    if (result.kind !== 'error') {
      throw new Error(`expected error, got ${result.kind}`);
    }
    expect(result.diagnostics[0]).toMatchObject({
      code: 'SVELTE_ATTRS_ARGUMENT_UNRESOLVED',
      location: {
        start: { line: 3, column: 26 },
        end: { line: 3, column: 31 },
      },
    });
  });
});
