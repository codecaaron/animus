import { describe, expect, test } from 'vitest';

import {
  buildSourceTokenIndex,
  correlateExternalTokenDiagnostics,
} from '../pipeline/correlate-external-tokens';

import type { ManifestDiagnostic } from '../pipeline/manifest-diagnostics';

/**
 * The cross-source correlation join (extraction-diagnostics): engine
 * candidates only become findings when the file belongs to a discovered
 * source AND that source's own token manifest defines the token.
 */

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

  test('absent or invalid manifests JSON yields an empty index', () => {
    expect(
      buildSourceTokenIndex({
        sourceThemeManifestsJson: null,
        dirOwners: { [KIT_DIR]: '@acme/ui-kit' },
      }).size
    ).toBe(0);
    expect(
      buildSourceTokenIndex({
        sourceThemeManifestsJson: 'not json',
        dirOwners: { [KIT_DIR]: '@acme/ui-kit' },
      }).size
    ).toBe(0);
  });
});
