// scripts/verify/rust-policy.test.ts
//
// Behavior tests for the fail-closed Rust suppression policy (design D5, G4/G5).
// Pure-function level: blanket suppression detection over authored source tokens
// and cargo-machete ignore detection over parsed metadata. No test asserts that
// a script/config merely contains a command string (design D6).

import { describe, expect, test } from 'vitest';

import {
  findBlanketSuppressions,
  findIgnoredDeps,
  stripComments,
} from './rust-policy';

describe('findBlanketSuppressions: blanket allow/expect fails', () => {
  test('multiline crate-wide #![allow(warnings)]', () => {
    const src = `#![allow(\n  warnings\n)]\n\npub fn f() {}\n`;
    const findings = findBlanketSuppressions(src, 'lib.rs');
    expect(findings).toHaveLength(1);
    expect(findings[0].lint).toBe('warnings');
    expect(findings[0].file).toBe('lib.rs');
  });

  test('module-level #[allow(clippy::all)]', () => {
    const src = `#[allow(clippy::all)]\nmod inner {}\n`;
    const findings = findBlanketSuppressions(src, 'x.rs');
    expect(findings).toHaveLength(1);
    expect(findings[0].lint).toBe('clippy::all');
  });

  test('cfg_attr(..., allow(warnings)) wrapper', () => {
    const src = `#[cfg_attr(feature = "dev", allow(warnings))]\nfn g() {}\n`;
    const findings = findBlanketSuppressions(src, 'y.rs');
    expect(findings).toHaveLength(1);
    expect(findings[0].lint).toBe('warnings');
  });

  test('expect(clippy::all) is also blanket', () => {
    const src = `#[expect(clippy::all)]\nfn h() {}\n`;
    const findings = findBlanketSuppressions(src, 'z.rs');
    expect(findings).toHaveLength(1);
    expect(findings[0].lint).toBe('clippy::all');
  });

  test('blanket lint mixed with a narrow lint in one group still fails', () => {
    const src = `#[allow(clippy::too_many_arguments, warnings)]\nfn h() {}\n`;
    const findings = findBlanketSuppressions(src, 'z.rs');
    expect(findings).toHaveLength(1);
    expect(findings[0].lint).toBe('warnings');
  });
});

describe('findBlanketSuppressions: narrow allow passes', () => {
  test('#[allow(clippy::too_many_arguments)] is preserved', () => {
    const src = `#[allow(clippy::too_many_arguments)]\nfn wide() {}\n`;
    expect(findBlanketSuppressions(src, 'a.rs')).toHaveLength(0);
  });

  test('#[allow(dead_code)] is preserved', () => {
    const src = `#[allow(dead_code)]\nfn unused() {}\n`;
    expect(findBlanketSuppressions(src, 'b.rs')).toHaveLength(0);
  });

  test('#[allow(clippy::new_without_default)] is preserved', () => {
    const src = `#[allow(clippy::new_without_default)]\nimpl Foo {}\n`;
    expect(findBlanketSuppressions(src, 'c.rs')).toHaveLength(0);
  });
});

describe('findBlanketSuppressions: comment stripping', () => {
  test('commented-out blanket suppression does not trip', () => {
    const src = `// #![allow(warnings)]\n/* #[allow(clippy::all)] */\nfn f() {}\n`;
    expect(findBlanketSuppressions(src, 'd.rs')).toHaveLength(0);
  });

  test('stripComments removes line and block comments', () => {
    expect(stripComments('a // b\nc')).toBe('a \nc');
    expect(stripComments('a /* b */ c')).toBe('a   c');
  });
});

describe('findIgnoredDeps: cargo-machete ignore policy', () => {
  test('non-empty ignore list fails and names package + deps', () => {
    const metadata = {
      packages: [
        {
          name: 'animus-extract-v2',
          metadata: { 'cargo-machete': { ignored: ['napi', 'serde_json'] } },
        },
      ],
    };
    const findings = findIgnoredDeps(metadata);
    expect(findings).toHaveLength(1);
    expect(findings[0].package).toBe('animus-extract-v2');
    expect(findings[0].ignored).toEqual(['napi', 'serde_json']);
  });

  test('empty ignore list passes', () => {
    const metadata = {
      packages: [
        {
          name: 'animus-system-loader',
          metadata: { 'cargo-machete': { ignored: [] } },
        },
      ],
    };
    expect(findIgnoredDeps(metadata)).toHaveLength(0);
  });

  test('absent package.metadata passes', () => {
    const metadata = {
      packages: [{ name: 'animus-extract-v2', metadata: null }],
    };
    expect(findIgnoredDeps(metadata)).toHaveLength(0);
  });

  test('multiple packages: only the offending one is reported', () => {
    const metadata = {
      packages: [
        { name: 'clean-crate', metadata: null },
        {
          name: 'dirty-crate',
          metadata: { 'cargo-machete': { ignored: ['unused_dep'] } },
        },
      ],
    };
    const findings = findIgnoredDeps(metadata);
    expect(findings).toHaveLength(1);
    expect(findings[0].package).toBe('dirty-crate');
  });
});
