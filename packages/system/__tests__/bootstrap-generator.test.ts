/**
 * Generator-shape tests for `createAppearanceBootstrap` (increment 02).
 *
 * Covers spec `color-mode-bootstrap`:
 * - "Generated bootstrap artifact" (artifact shape, deterministic output,
 *   custom storage key honored)
 * - "Appearance record contract" (single key, default `animus:appearance`)
 *
 * Snippet BEHAVIOR lives in bootstrap-snippet.test.ts; packaging/isolation in
 * bootstrap-packaging.test.ts.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { createTheme } from '../src';
import { createAppearanceBootstrap } from '../src/bootstrap';

/** Minimal structural stand-in for a built theme's manifest. */
function themeWithModes(...modeNames: string[]) {
  return {
    manifest: {
      modes: Object.fromEntries(
        modeNames.map((name) => [name, { 'colors.primary': '#000000' }])
      ),
    },
  };
}

/** A real built theme — proves the generator reads `manifest.modes`. */
function builtTheme() {
  return createTheme()
    .addBreakpoints({ xs: 480, sm: 768, md: 1024, lg: 1200, xl: 1440 })
    .addColors({ void: '#000000', bone: '#ffffff' })
    .addColorModes('midnight', {
      midnight: { primary: 'void' },
      paper: { primary: 'bone' },
    })
    .build();
}

describe('createAppearanceBootstrap — artifact shape', () => {
  it('returns a non-empty code string and a sha256- prefixed cspHash', () => {
    const artifact = createAppearanceBootstrap(themeWithModes('midnight'), {
      storageKey: 'animus:appearance',
    });

    expect(typeof artifact.code).toBe('string');
    expect(artifact.code.length).toBeGreaterThan(0);
    expect(artifact.cspHash).toMatch(/^sha256-[A-Za-z0-9+/]+={0,2}$/);
  });

  it('cspHash is the base64 sha256 digest of the exact code bytes', () => {
    const artifact = createAppearanceBootstrap(themeWithModes('midnight'));
    const expected = createHash('sha256')
      .update(artifact.code, 'utf8')
      .digest('base64');

    expect(artifact.cspHash).toBe(`sha256-${expected}`);
  });

  it('accepts a real built theme and embeds its declared modes', () => {
    const artifact = createAppearanceBootstrap(builtTheme());

    expect(artifact.code).toContain('midnight');
    expect(artifact.code).toContain('paper');
    expect(artifact.cspHash.startsWith('sha256-')).toBe(true);
  });

  it('emits a self-contained IIFE with no imports or placeholders', () => {
    const { code } = createAppearanceBootstrap(themeWithModes('midnight'));

    expect(code.startsWith('(function(')).toBe(true);
    expect(code).not.toContain('import');
    expect(code).not.toContain('require(');
    expect(code).not.toMatch(/\$\{|__[A-Z_]+__/);
  });
});

describe('createAppearanceBootstrap — determinism', () => {
  it('produces byte-identical code and hash for identical inputs', () => {
    const first = createAppearanceBootstrap(
      themeWithModes('paper', 'midnight')
    );
    const second = createAppearanceBootstrap(
      themeWithModes('paper', 'midnight')
    );

    expect(first.code).toBe(second.code);
    expect(first.cspHash).toBe(second.cspHash);
  });

  it('is insensitive to declaration order of the modes (sorted allowlist)', () => {
    const forward = createAppearanceBootstrap(themeWithModes('alpha', 'zeta'));
    const reversed = createAppearanceBootstrap(themeWithModes('zeta', 'alpha'));

    expect(forward.code).toBe(reversed.code);
    expect(forward.code.indexOf('alpha')).toBeLessThan(
      forward.code.indexOf('zeta')
    );
  });
});

describe('createAppearanceBootstrap — storage key', () => {
  it('defaults to the single `animus:appearance` record key', () => {
    const { code } = createAppearanceBootstrap(themeWithModes('midnight'));

    expect(code).toContain('animus:appearance');
  });

  it('reads a custom storage key and never the default', () => {
    const { code } = createAppearanceBootstrap(themeWithModes('midnight'), {
      storageKey: 'acme:appearance',
    });

    expect(code).toContain('acme:appearance');
    expect(code).not.toContain('animus:appearance');
  });

  it('rejects an empty storage key', () => {
    expect(() =>
      createAppearanceBootstrap(themeWithModes('midnight'), { storageKey: '' })
    ).toThrow(/storageKey/);
  });
});

describe('createAppearanceBootstrap — generation guards', () => {
  it('throws when the theme declares no modes', () => {
    expect(() =>
      createAppearanceBootstrap({ manifest: { modes: {} } })
    ).toThrow(/no color modes/i);
  });

  it('throws when the theme has no manifest at all', () => {
    expect(() => createAppearanceBootstrap({ manifest: {} })).toThrow(
      /no color modes/i
    );
  });

  it('throws when a declared mode uses the reserved name `system`', () => {
    expect(() =>
      createAppearanceBootstrap(themeWithModes('midnight', 'system'))
    ).toThrow(/reserved/i);
  });

  it('throws on an empty mode name', () => {
    expect(() =>
      createAppearanceBootstrap(themeWithModes('midnight', ''))
    ).toThrow(/empty or whitespace-only/i);
  });

  it('throws on a whitespace-only mode name', () => {
    expect(() =>
      createAppearanceBootstrap(themeWithModes('midnight', ' \t '))
    ).toThrow(/empty or whitespace-only/i);
  });
});

// Mode names reach the generator as manifest KEYS — the theme builder does not
// reject punctuation today, so the embedding must be hostile-input safe. A
// naive template interpolation passes every other test in this file and fails
// every assertion here.
describe('createAppearanceBootstrap — hostile mode names', () => {
  // Built from code points so this source file stays pure ASCII — an invisible
  // separator pasted into a test is exactly the bug being guarded against.
  const LINE_SEPARATOR = String.fromCharCode(0x2028);
  const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

  const HOSTILE_MODES = [
    'mid"night', // double quote — closes a naive string literal
    'back\\slash', // backslash — escapes the following character
    '</script><script>injected()</script>', // inline-script breakout
    '");injected();("', // expression breakout
    `sep${LINE_SEPARATOR}ara${PARAGRAPH_SEPARATOR}tor`, // line separators
  ];

  const hostileTheme = themeWithModes(...HOSTILE_MODES);

  it('emits no raw `<`, no `</script`, and no raw line separators', () => {
    const { code } = createAppearanceBootstrap(hostileTheme);

    expect(code).not.toContain('</script');
    expect(code).not.toContain('<');
    expect(code).not.toContain(LINE_SEPARATOR);
    expect(code).not.toContain(PARAGRAPH_SEPARATOR);
    expect(code).toContain('\\u003c');
    expect(code).toContain('\\u2028');
    expect(code).toContain('\\u2029');
  });

  it('parses and runs without executing any injected identifier', () => {
    const { code } = createAppearanceBootstrap(hostileTheme);
    const injected = vi.fn();
    const documentStub = {
      documentElement: { setAttribute: vi.fn(), removeAttribute: vi.fn() },
    };
    const storageStub = { getItem: () => null, setItem: vi.fn() };

    expect(() => {
      // Construction throws SyntaxError if the embedding broke the literal;
      // `injected` is shadowed so a successful breakout would still be caught.
      // oxlint-disable-next-line no-new-func
      const run = new Function(
        'document',
        'localStorage',
        'injected',
        code
      ) as (
        documentGlobal: unknown,
        storageGlobal: unknown,
        injectedGlobal: unknown
      ) => void;
      run(documentStub, storageStub, injected);
    }).not.toThrow();

    expect(injected).not.toHaveBeenCalled();
    expect(documentStub.documentElement.removeAttribute).toHaveBeenCalledWith(
      'data-color-mode'
    );
  });

  it('round-trips a hostile mode name byte-for-byte', () => {
    const { code } = createAppearanceBootstrap(hostileTheme);
    const setAttribute = vi.fn();
    const documentStub = {
      documentElement: { setAttribute, removeAttribute: vi.fn() },
    };
    const record = JSON.stringify({
      v: 1,
      mode: 'mid"night',
      theme: 'default',
    });
    const storageStub = { getItem: () => record, setItem: vi.fn() };

    // oxlint-disable-next-line no-new-func
    const run = new Function('document', 'localStorage', code) as (
      documentGlobal: unknown,
      storageGlobal: unknown
    ) => void;
    run(documentStub, storageStub);

    expect(setAttribute).toHaveBeenCalledWith('data-color-mode', 'mid"night');
  });
});
