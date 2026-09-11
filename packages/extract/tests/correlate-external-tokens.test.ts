import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, test } from 'vitest';

import {
  buildSourceTokenIndex,
  correlateExternalTokenDiagnostics,
  enforceExternalTokenContracts,
} from '../pipeline/correlate-external-tokens';

import type { ManifestDiagnostic } from '../pipeline/manifest-diagnostics';

const KIT_DIR = '/repo/packages/kit/src';

function candidate(
  overrides: Partial<ManifestDiagnostic> = {}
): ManifestDiagnostic {
  return {
    file: 'packages/kit/src/Card.tsx',
    component: 'KitCard',
    kind: 'external-token-candidate',
    message: "'colors.externalAccent' in 'background-color' did not resolve",
    token: 'colors.externalAccent',
    ...overrides,
  };
}

const FILE_OWNERS = { 'packages/kit/src/Card.tsx': '@acme/ui-kit' };

function kitTokenIndex(tokens: string[]): Map<string, Set<string>> {
  return new Map([['@acme/ui-kit', new Set(tokens)]]);
}

describe('correlateExternalTokenDiagnostics', () => {
  test('witness hit produces the teaching error naming all four pieces', () => {
    const messages = correlateExternalTokenDiagnostics({
      diagnostics: [candidate()],
      fileOwners: FILE_OWNERS,
      sourceTokens: kitTokenIndex(['colors.externalAccent']),
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('KitCard');
    expect(messages[0]).toContain("'@acme/ui-kit'");
    expect(messages[0]).toContain("'colors.externalAccent'");
    expect(messages[0]).toContain('createTheme().extend(');
  });

  test('a CSS literal the source does not define stays silent (witness miss)', () => {
    const messages = correlateExternalTokenDiagnostics({
      diagnostics: [candidate({ token: 'colors.red' })],
      fileOwners: FILE_OWNERS,
      sourceTokens: kitTokenIndex(['colors.externalAccent']),
    });

    expect(messages).toEqual([]);
  });

  test('consumer-local files stay silent (no ownership)', () => {
    const messages = correlateExternalTokenDiagnostics({
      diagnostics: [candidate({ file: 'src/App.tsx', component: 'Local' })],
      fileOwners: FILE_OWNERS,
      sourceTokens: kitTokenIndex(['colors.externalAccent']),
    });

    expect(messages).toEqual([]);
  });

  test('non-candidate kinds and tokenless diagnostics are ignored', () => {
    const messages = correlateExternalTokenDiagnostics({
      diagnostics: [
        candidate({ kind: 'warn' }),
        candidate({ token: undefined }),
      ],
      fileOwners: FILE_OWNERS,
      sourceTokens: kitTokenIndex(['colors.externalAccent']),
    });

    expect(messages).toEqual([]);
  });

  test('duplicate (component, token, source) findings dedupe to one message', () => {
    const messages = correlateExternalTokenDiagnostics({
      diagnostics: [candidate(), candidate()],
      fileOwners: FILE_OWNERS,
      sourceTokens: kitTokenIndex(['colors.externalAccent']),
    });

    expect(messages).toHaveLength(1);
  });
});

describe('buildSourceTokenIndex', () => {
  test('maps modules under a package dir to its specifier, unioning exports', () => {
    const index = buildSourceTokenIndex({
      sourceThemeManifestsJson: JSON.stringify({
        [`${KIT_DIR}/theme.ts`]: {
          referenceTokens: ['colors.externalAccent', 'space.4'],
        },
        [`${KIT_DIR}/extra.ts`]: { moreTokens: ['colors.deep'] },
      }),
      dirOwners: { [KIT_DIR]: '@acme/ui-kit' },
    });

    expect(index.get('@acme/ui-kit')).toEqual(
      new Set(['colors.externalAccent', 'space.4', 'colors.deep'])
    );
  });

  test('modules outside every package dir contribute nothing', () => {
    const index = buildSourceTokenIndex({
      sourceThemeManifestsJson: JSON.stringify({
        '/repo/src/theme.ts': { tokens: ['colors.consumer'] },
      }),
      dirOwners: { [KIT_DIR]: '@acme/ui-kit' },
    });

    expect(index.size).toBe(0);
  });

  test('absent manifests JSON yields an empty index', () => {
    expect(
      buildSourceTokenIndex({
        sourceThemeManifestsJson: null,
        dirOwners: { [KIT_DIR]: '@acme/ui-kit' },
      }).size
    ).toBe(0);
  });

  test('malformed manifests JSON throws, naming the wire and the cause', () => {
    expect(() =>
      buildSourceTokenIndex({
        sourceThemeManifestsJson: 'not json',
        dirOwners: { [KIT_DIR]: '@acme/ui-kit' },
      })
    ).toThrow(/sourceThemeManifestsJson/);
    expect(() =>
      buildSourceTokenIndex({
        sourceThemeManifestsJson: 'not json',
        dirOwners: { [KIT_DIR]: '@acme/ui-kit' },
      })
    ).toThrow(/SyntaxError/);
  });
});

describe('buildSourceTokenIndex package-boundary join', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function makeKit() {
    const scratch = mkdtempSync(join(tmpdir(), 'animus-correlate-'));
    tempRoots.push(scratch);
    const pkgRoot = join(scratch, 'packages', 'kit');
    mkdirSync(join(pkgRoot, 'src'), { recursive: true });
    mkdirSync(join(pkgRoot, 'dist'), { recursive: true });
    writeFileSync(join(pkgRoot, 'package.json'), '{"name":"@acme/ui-kit"}');
    const realRoot = realpathSync(pkgRoot);
    return {
      srcDir: join(pkgRoot, 'src'),
      distModule: join(realRoot, 'dist', 'theme.mjs'),
    };
  }

  test('a loader dist module joins a src-keyed owner via the package root', () => {
    const { srcDir, distModule } = makeKit();

    const index = buildSourceTokenIndex({
      sourceThemeManifestsJson: JSON.stringify({
        [distModule]: { theme: ['colors.externalAccent'] },
      }),
      dirOwners: { [srcDir]: '@acme/ui-kit/definition' },
    });

    expect(index.get('@acme/ui-kit/definition')).toEqual(
      new Set(['colors.externalAccent'])
    );
  });

  test('a missing owner dir never claims modules through the filesystem root', () => {
    const index = buildSourceTokenIndex({
      sourceThemeManifestsJson: JSON.stringify({
        '/somewhere/else/theme.ts': { theme: ['colors.externalAccent'] },
      }),
      dirOwners: { '/nonexistent-animus-test/packages/kit/src': '@x/ghost' },
    });

    expect(index.size).toBe(0);
  });

  test('the full gate fires strict on a dist-shaped manifest', () => {
    const { srcDir, distModule } = makeKit();

    expect(() =>
      enforceExternalTokenContracts({
        diagnostics: [candidate()],
        fileOwners: FILE_OWNERS,
        dirOwners: { [srcDir]: '@acme/ui-kit' },
        sourceThemeManifestsJson: JSON.stringify({
          [distModule]: { theme: ['colors.externalAccent'] },
        }),
        strict: true,
        prefix: '[animus-extract]',
        warn: () => {},
      })
    ).toThrow(/KitCard.*'colors\.externalAccent'/s);
  });
});
