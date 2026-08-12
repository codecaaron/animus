import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import {
  AnimusConfigError,
  assertKnownOptionKeys,
  createExcludeMatcher,
  DEFAULT_EXCLUDE,
  resolveMode,
  STRUCTURAL_EXCLUDE,
} from '../pipeline/core-options';
import { discoverFiles } from '../pipeline/discover-files';

describe('assertKnownOptionKeys', () => {
  test('accepts every core key and driver namespaces', () => {
    expect(() =>
      assertKnownOptionKeys({
        system: './ds.ts',
        exclude: [],
        extensions: ['.tsx'],
        strict: true,
        verbose: false,
        prefix: 'anm',
        targets: 'defaults',
        minify: true,
        staticCss: {},
        layers: [],
        engine: 'v2',
        mode: 'production',
        root: '.',
        vite: { verify: true },
        next: { turbopack: { mode: 'auto' } },
        cli: { outDir: '.animus' },
      })
    ).not.toThrow();
  });

  test('wrongly-typed core values always throw — never silently coerce', () => {
    // The polarity keys: a string "false" is truthy, so an untyped
    // passthrough ENABLES what the config reads as disabling.
    expect(() =>
      assertKnownOptionKeys({ system: './ds.ts', strict: 'false' })
    ).toThrow(/"strict".*boolean/);
    expect(() =>
      assertKnownOptionKeys({ system: './ds.ts', minify: 'false' })
    ).toThrow(/"minify".*boolean/);
    // A bare-string exclude/extensions is the natural single-value
    // misspelling; untyped it becomes zero patterns / a Set of CHARACTERS.
    expect(() =>
      assertKnownOptionKeys({ system: './ds.ts', exclude: 'fixtures' })
    ).toThrow(/"exclude".*array/);
    expect(() =>
      assertKnownOptionKeys({ system: './ds.ts', extensions: '.tsx' })
    ).toThrow(/"extensions".*array/);
    expect(() =>
      assertKnownOptionKeys({ system: './ds.ts', exclude: [1] })
    ).toThrow(AnimusConfigError);
    expect(() =>
      assertKnownOptionKeys({
        system: './ds.ts',
        system2: undefined,
        prefix: 5,
      })
    ).toThrow(AnimusConfigError);
    // Type errors are fatal even in warn mode — only unknown KEYS warn.
    expect(() =>
      assertKnownOptionKeys({ system: './ds.ts', strict: 'true' }, [], [], {
        onUnknownKey: 'warn',
        warn: () => {},
      })
    ).toThrow(/"strict"/);
    // Valid shapes stay accepted (string-or-array targets included).
    expect(() =>
      assertKnownOptionKeys({ system: './ds.ts', targets: ['defaults'] })
    ).not.toThrow();
    expect(() =>
      assertKnownOptionKeys({ system: './ds.ts', targets: 'defaults' })
    ).not.toThrow();
  });

  test('rejects an unknown top-level key, naming it with a suggestion', () => {
    expect(() =>
      assertKnownOptionKeys({ system: './ds.ts', exclide: [] })
    ).toThrow(AnimusConfigError);
    try {
      assertKnownOptionKeys({ system: './ds.ts', exclide: [] });
    } catch (error) {
      expect((error as Error).message).toContain('"exclide"');
      expect((error as Error).message).toContain('"exclude"');
    }
  });

  test('a driver-owned legacy key passes only when declared as ownKeys', () => {
    const raw = { system: './ds.ts', cssImportTarget: 'app/layout.tsx' };
    expect(() => assertKnownOptionKeys(raw)).toThrow(AnimusConfigError);
    expect(() => assertKnownOptionKeys(raw, ['cssImportTarget'])).not.toThrow();
  });

  test('a rejectKeys entry fails loud with the driver reason', () => {
    const raw = { system: './ds.ts', root: '/elsewhere' };
    expect(() => assertKnownOptionKeys(raw)).not.toThrow();
    expect(() =>
      assertKnownOptionKeys(raw, [], [{ key: 'root', reason: 'host owns it' }])
    ).toThrow(/not supported by this driver: host owns it/);
  });

  test('undefined-valued keys are inert', () => {
    expect(() =>
      assertKnownOptionKeys(
        { system: './ds.ts', root: undefined },
        [],
        [{ key: 'root', reason: 'host owns it' }]
      )
    ).not.toThrow();
  });

  test('an invalid mode value fails loud instead of flipping polarity', () => {
    expect(() =>
      assertKnownOptionKeys({ system: './ds.ts', mode: 'prod' })
    ).toThrow(/Invalid mode "prod"/);
  });

  test('warn mode surfaces unknown and rejected keys without throwing (published entry points)', () => {
    const warnings: string[] = [];
    const warn = (message: string) => warnings.push(message);
    // The regression this pins: the published withAnimus/animusExtract
    // entry points threw at config load for any extra top-level key —
    // including previously-inert `root` — with no deprecation window.
    expect(() =>
      assertKnownOptionKeys(
        { system: './ds.ts', extraneous: 1, root: '/elsewhere' },
        [],
        [{ key: 'root', reason: 'host owns it' }],
        { onUnknownKey: 'warn', warn }
      )
    ).not.toThrow();
    expect(warnings.join('\n')).toContain('"extraneous"');
    expect(warnings.join('\n')).toContain('host owns it');
  });

  test('warn mode still throws on an invalid mode VALUE', () => {
    expect(() =>
      assertKnownOptionKeys({ system: './ds.ts', mode: 'prod' }, [], [], {
        onUnknownKey: 'warn',
        warn: () => {},
      })
    ).toThrow(/Invalid mode "prod"/);
  });
});

describe('createExcludeMatcher', () => {
  test('a user list replaces the replaceable defaults — structural exclusions stay', () => {
    const matcher = createExcludeMatcher(['fixtures']);
    expect(matcher.patterns).toEqual([...STRUCTURAL_EXCLUDE, 'fixtures']);
    expect(
      matcher.matches('/app/node_modules/x/index.ts', 'node_modules/x/index.ts')
    ).toBe(true);
    expect(matcher.matches('/app/fixtures/a.ts', 'fixtures/a.ts')).toBe(true);
    expect(matcher.matches('/app/src/a.ts', 'src/a.ts')).toBe(false);
  });

  test('a user list can re-admit a replaceable default like "dist"', () => {
    // The HEAD driver contract: `exclude` REPLACES the defaults. A consumer
    // whose components live under src/dist-utils/ excludes only tests and
    // must get dist-substring paths back.
    const matcher = createExcludeMatcher(['.test.', '.spec.']);
    expect(
      matcher.matches(
        '/app/src/dist-utils/Button.tsx',
        'src/dist-utils/Button.tsx'
      )
    ).toBe(false);
    expect(matcher.matches('/app/src/a.test.ts', 'src/a.test.ts')).toBe(true);
  });

  test('no user list applies the full default set', () => {
    const matcher = createExcludeMatcher();
    expect([...matcher.patterns].sort()).toEqual([...DEFAULT_EXCLUDE].sort());
    expect(matcher.matches('/app/dist/a.ts', 'dist/a.ts')).toBe(true);
  });

  test('structural exclusions cannot be re-admitted by any user list', () => {
    const matcher = createExcludeMatcher([]);
    expect(
      matcher.matches('/app/.animus/styles.css', '.animus/styles.css')
    ).toBe(true);
    expect(matcher.matches('/app/.next/x.ts', '.next/x.ts')).toBe(true);
    expect(
      matcher.matches('/app/node_modules/p/i.ts', 'node_modules/p/i.ts')
    ).toBe(true);
    expect(matcher.matches('/app/dist/a.ts', 'dist/a.ts')).toBe(false);
  });

  test('a leading ./ glob matches the bare root-relative path', () => {
    const matcher = createExcludeMatcher(['./fixtures/**']);
    expect(matcher.matches('/app/fixtures/a.tsx', 'fixtures/a.tsx')).toBe(true);
    expect(
      matcher.matches('/app/fixtures/deep/b.tsx', 'fixtures/deep/b.tsx')
    ).toBe(true);
    expect(matcher.matches('/app/src/a.tsx', 'src/a.tsx')).toBe(false);
    // The original spelling stays the reporting key.
    expect(matcher.explain('/app/fixtures/a.tsx', 'fixtures/a.tsx')).toBe(
      './fixtures/**'
    );
  });

  test('a leading ./ substring pattern matches root-relative paths', () => {
    const matcher = createExcludeMatcher(['./generated']);
    expect(matcher.matches('/app/generated/a.ts', 'generated/a.ts')).toBe(true);
  });

  test('extraStructural joins the never-replaceable set without touching replace semantics', () => {
    const noUser = createExcludeMatcher(undefined, ['out/**']);
    expect(noUser.matches('/app/out/styles.css', 'out/styles.css')).toBe(true);
    expect(noUser.matches('/app/dist/a.ts', 'dist/a.ts')).toBe(true);
    const withUser = createExcludeMatcher(['.test.'], ['out/**']);
    expect(withUser.matches('/app/out/styles.css', 'out/styles.css')).toBe(
      true
    );
    // The user list still replaces the replaceable defaults…
    expect(withUser.matches('/app/dist/a.ts', 'dist/a.ts')).toBe(false);
    // …and can never re-admit a structural entry.
    expect(
      withUser.matches('/app/node_modules/p/i.ts', 'node_modules/p/i.ts')
    ).toBe(true);
  });

  test('a bare "./" pattern matches nothing instead of everything', () => {
    const matcher = createExcludeMatcher(['./']);
    expect(matcher.matches('/app/src/a.ts', 'src/a.ts')).toBe(false);
  });

  test('substring patterns keep matching both path forms', () => {
    const matcher = createExcludeMatcher();
    expect(matcher.matches('/app/src/a.test.ts', 'src/a.test.ts')).toBe(true);
    // Absolute-path substring hit even when the relative path is clean —
    // historical behavior preserved for patterns without glob metacharacters.
    expect(matcher.matches('/opt/dist-host/app/src/a.ts', 'src/a.ts')).toBe(
      true
    );
  });

  test('glob patterns match root-relative paths across directories', () => {
    const matcher = createExcludeMatcher(['**/*.stories.tsx']);
    expect(
      matcher.matches(
        '/app/src/deep/Button.stories.tsx',
        'src/deep/Button.stories.tsx'
      )
    ).toBe(true);
    expect(
      matcher.matches('/app/Button.stories.tsx', 'Button.stories.tsx')
    ).toBe(true);
    expect(matcher.matches('/app/src/Button.tsx', 'src/Button.tsx')).toBe(
      false
    );
  });

  test('single-star and question-mark stay within one segment', () => {
    const matcher = createExcludeMatcher(['src/*.gen.ts', 'src/page?.ts']);
    expect(matcher.matches('/a/src/x.gen.ts', 'src/x.gen.ts')).toBe(true);
    expect(matcher.matches('/a/src/deep/x.gen.ts', 'src/deep/x.gen.ts')).toBe(
      false
    );
    expect(matcher.matches('/a/src/page1.ts', 'src/page1.ts')).toBe(true);
    expect(matcher.matches('/a/src/page10.ts', 'src/page10.ts')).toBe(false);
  });

  test('a directory-shaped glob excludes files under it (watch parity)', () => {
    const matcher = createExcludeMatcher(['**/generated']);
    // Discovery prunes at the directory; watch classification only ever
    // sees file paths — both must agree.
    expect(matcher.matches('/a/src/generated', 'src/generated')).toBe(true);
    expect(matcher.matches('/a/src/generated/x.ts', 'src/generated/x.ts')).toBe(
      true
    );
    expect(
      matcher.matches('/a/src/generated/deep/y.ts', 'src/generated/deep/y.ts')
    ).toBe(true);
    expect(matcher.matches('/a/src/gen/x.ts', 'src/gen/x.ts')).toBe(false);
  });

  test('explain names the responsible pattern', () => {
    const matcher = createExcludeMatcher(['**/*.stories.tsx']);
    expect(matcher.explain('/a/src/B.stories.tsx', 'src/B.stories.tsx')).toBe(
      '**/*.stories.tsx'
    );
    expect(
      matcher.explain('/a/node_modules/p/i.ts', 'node_modules/p/i.ts')
    ).toBe('node_modules');
    expect(matcher.explain('/a/src/B.tsx', 'src/B.tsx')).toBeNull();
  });
});

describe('resolveMode', () => {
  test('explicit mode wins over the driver default', () => {
    expect(resolveMode('development', () => 'production')).toEqual({
      mode: 'development',
      provenance: 'explicit',
    });
  });

  test('absent mode falls to the driver default with provenance', () => {
    expect(resolveMode(undefined, () => 'production')).toEqual({
      mode: 'production',
      provenance: 'driver-default',
    });
  });
});

describe('discoverFiles with an ExcludeMatcher', () => {
  const makeTree = (): string => {
    const root = mkdtempSync(join(tmpdir(), 'core-options-discover-'));
    mkdirSync(join(root, 'src', 'deep'), { recursive: true });
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(root, 'src', 'App.tsx'), 'export {};');
    writeFileSync(join(root, 'src', 'App.stories.tsx'), 'export {};');
    writeFileSync(join(root, 'src', 'deep', 'Card.stories.tsx'), 'export {};');
    writeFileSync(join(root, 'node_modules', 'pkg', 'index.tsx'), 'export {};');
    return root;
  };

  test('glob exclusion prunes matching files while defaults still apply', () => {
    const root = makeTree();
    const matcher = createExcludeMatcher(['**/*.stories.tsx']);
    const files = discoverFiles(root, root, matcher, new Set(['.tsx'])).map(
      (file) => file.slice(root.length + 1)
    );
    expect(files).toEqual([join('src', 'App.tsx')]);
  });

  test('discovery order is deterministic depth-first lexicographic', () => {
    const root = mkdtempSync(join(tmpdir(), 'core-options-discover-'));
    // Created in anti-alphabetical order so filesystems that surface
    // creation order would betray an unsorted walk.
    mkdirSync(join(root, 'zeta'), { recursive: true });
    writeFileSync(join(root, 'zeta', 'z.tsx'), 'export {};');
    writeFileSync(join(root, 'zeta', 'a.tsx'), 'export {};');
    writeFileSync(join(root, 'top.tsx'), 'export {};');
    mkdirSync(join(root, 'alpha'), { recursive: true });
    writeFileSync(join(root, 'alpha', 'b.tsx'), 'export {};');
    const files = discoverFiles(
      root,
      root,
      createExcludeMatcher(),
      new Set(['.tsx'])
    ).map((file) => file.slice(root.length + 1));
    expect(files).toEqual([
      join('alpha', 'b.tsx'),
      'top.tsx',
      join('zeta', 'a.tsx'),
      join('zeta', 'z.tsx'),
    ]);
  });

  test('undefined exclusion walks EVERYTHING — the dist-package walk under node_modules', () => {
    const root = makeTree();
    const files = discoverFiles(root, root, undefined, new Set(['.tsx'])).map(
      (file) => file.slice(root.length + 1)
    );
    expect(files).toContain(join('node_modules', 'pkg', 'index.tsx'));
    expect(files).toContain(join('src', 'App.tsx'));
  });
});
