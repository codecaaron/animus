// scripts/verify/rust-policy.test.ts
//
// Behavior tests for the fail-closed Rust suppression policy (design D5, G4/G5).
// Pure-function level: blanket suppression detection over authored source tokens
// and cargo-machete ignore detection over parsed metadata. No test asserts that
// a script/config merely contains a command string (design D6).

import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

import {
  findBlanketSuppressions,
  findIgnoredDeps,
  findLintTableDivergences,
  parseLintTables,
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

describe('parseLintTables: [lints.*] extraction', () => {
  test('captures rust and clippy tables, ignoring other sections', () => {
    const toml = [
      '[package]',
      'name = "x"',
      '',
      '[lints.rust]',
      'unused_lifetimes = "warn"',
      '',
      '[lints.clippy]',
      'dbg_macro = "warn"',
      '',
      '[profile.release]',
      'lto = true',
    ].join('\n');
    expect(parseLintTables(toml)).toEqual({
      'lints.rust': { unused_lifetimes: 'warn' },
      'lints.clippy': { dbg_macro: 'warn' },
    });
  });

  test('comments and blank lines do not become lint entries', () => {
    const toml = [
      '[lints.rust]',
      '# unused_unsafe = "warn"  <- deliberately commented out',
      'unit_bindings = "warn"   # trailing note',
      '',
    ].join('\n');
    expect(parseLintTables(toml)).toEqual({
      'lints.rust': { unit_bindings: 'warn' },
    });
  });

  test('inline-table levels are compared verbatim', () => {
    const toml = '[lints.clippy]\nexit = { level = "warn", priority = -1 }\n';
    expect(parseLintTables(toml)['lints.clippy'].exit).toBe(
      '{ level = "warn", priority = -1 }'
    );
  });

  test('a manifest with no lint tables yields nothing', () => {
    expect(parseLintTables('[package]\nname = "x"\n')).toEqual({});
  });
});

describe('findLintTableDivergences: crate lint posture parity', () => {
  const A =
    '[lints.rust]\nunused_lifetimes = "warn"\n[lints.clippy]\nexit = "warn"\n';

  test('identical tables pass', () => {
    expect(
      findLintTableDivergences([
        { file: 'a/Cargo.toml', source: A },
        { file: 'b/Cargo.toml', source: A },
      ])
    ).toHaveLength(0);
  });

  test('a lint added to only one crate is reported', () => {
    const b = A.replace('exit = "warn"', 'exit = "warn"\ntodo = "warn"');
    const findings = findLintTableDivergences([
      { file: 'a/Cargo.toml', source: A },
      { file: 'b/Cargo.toml', source: b },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].table).toBe('lints.clippy');
    expect(findings[0].lint).toBe('todo');
    expect(findings[0].values).toEqual({
      'a/Cargo.toml': null,
      'b/Cargo.toml': 'warn',
    });
  });

  test('a level downgraded in one crate is reported', () => {
    const b = A.replace('exit = "warn"', 'exit = "allow"');
    const findings = findLintTableDivergences([
      { file: 'a/Cargo.toml', source: A },
      { file: 'b/Cargo.toml', source: b },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].values).toEqual({
      'a/Cargo.toml': 'warn',
      'b/Cargo.toml': 'allow',
    });
  });

  test('a whole table missing from one crate is reported per lint', () => {
    const findings = findLintTableDivergences([
      { file: 'a/Cargo.toml', source: A },
      {
        file: 'b/Cargo.toml',
        source: '[lints.rust]\nunused_lifetimes = "warn"\n',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].table).toBe('lints.clippy');
    expect(findings[0].lint).toBe('exit');
  });

  test('findings are sorted by table then lint for a stable report', () => {
    const findings = findLintTableDivergences([
      { file: 'a/Cargo.toml', source: A },
      { file: 'b/Cargo.toml', source: '' },
    ]);
    expect(findings.map((f) => `${f.table}/${f.lint}`)).toEqual([
      'lints.clippy/exit',
      'lints.rust/unused_lifetimes',
    ]);
  });

  test('fewer than two manifests cannot establish parity', () => {
    expect(() =>
      findLintTableDivergences([{ file: 'a/Cargo.toml', source: A }])
    ).toThrow();
  });
});

describe('the shipped crate manifests hold the parity invariant', () => {
  test('extract-v2 and system-loader declare the same lint posture', () => {
    const manifests = [
      'packages/extract/crates/extract-v2/Cargo.toml',
      'packages/extract/crates/system-loader/Cargo.toml',
    ].map((file) => ({ file, source: readFileSync(file, 'utf8') }));

    // Non-vacuity: a passing comparison of two empty tables would prove nothing.
    const tables = parseLintTables(manifests[0].source);
    expect(Object.keys(tables['lints.clippy'] ?? {}).length).toBeGreaterThan(5);

    expect(findLintTableDivergences(manifests)).toEqual([]);
  });
});
