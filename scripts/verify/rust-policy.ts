#!/usr/bin/env bun
// scripts/verify/rust-policy.ts
//
// Pure fail-closed policy validator for authored Rust suppression surfaces
// (design D5, guardrails G4/G5). Two CLI modes, both fail non-zero on a finding
// so a broad suppression cannot silently absorb unrelated future failures while
// `cargo clippy -D warnings` / `cargo machete` still report green.
//
//   source <path>...   Scan authored `.rs` files (dirs recursed, `target/`
//                      skipped) for crate-wide / module-wide / cfg_attr-wrapped
//                      `allow|expect(warnings)` and `allow|expect(clippy::all)`.
//                      Narrow named-lint allows (e.g. clippy::too_many_arguments,
//                      dead_code) are preserved so Clippy still evaluates them.
//   metadata           Read `cargo metadata --no-deps --format-version 1` JSON
//                      from stdin; reject any non-empty
//                      `[package.metadata.cargo-machete].ignored` list.
//
// The token scan operates on comment-stripped source only; it deliberately does
// not interpret generated macro output (design trade-off: authored crate/module
// attributes are the plausible bypass; the blind spot is explicit — G4).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// The two blanket lint groups a suppression must never silence wholesale.
export const BLANKET_LINTS = new Set(['warnings', 'clippy::all']);

export interface SuppressionFinding {
  file: string;
  attribute: string; // the offending `allow(...)`/`expect(...)` group, verbatim-ish
  lint: string; // which blanket lint tripped it
}

export interface IgnoredDepFinding {
  package: string;
  ignored: string[];
}

// Removes Rust line (`//`, `///`, `//!`) and block (`/* */`, `/** */`) comments
// so a commented-out `#![allow(warnings)]` cannot trip the scan and, conversely,
// so a real attribute trailing an inline comment still tokenizes. String-literal
// contents are intentionally left in place: attribute macros do not live inside
// string literals, and stripping strings correctly would require a full lexer
// the fail-closed policy does not warrant.
export function stripComments(source: string): string {
  let out = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    const two = source.slice(i, i + 2);
    if (two === '//') {
      const nl = source.indexOf('\n', i);
      if (nl === -1) break;
      i = nl; // keep the newline so line numbers/whitespace boundaries survive
    } else if (two === '/*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      out += ' ';
    } else {
      out += source[i];
      i += 1;
    }
  }
  return out;
}

// Scans one comment-stripped source for blanket suppressions. Every
// `allow(...)`/`expect(...)` group is inspected, including groups nested inside
// `cfg_attr(<cond>, allow(...))` — the nested `allow(warnings)` substring is
// matched directly, so no cfg_attr-specific parsing is required. A group trips
// only when one of its comma-separated lint tokens is exactly a blanket lint.
export function findBlanketSuppressions(
  source: string,
  file: string
): SuppressionFinding[] {
  const stripped = stripComments(source);
  const findings: SuppressionFinding[] = [];
  // `[^()]*` keeps each group to a single non-nested lint list. cfg_attr's outer
  // parens are skipped over; its inner allow/expect group is matched on its own.
  const groupRe = /\b(allow|expect)\s*\(\s*([^()]*?)\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = groupRe.exec(stripped)) !== null) {
    const lints = m[2]
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    for (const lint of lints) {
      if (BLANKET_LINTS.has(lint)) {
        findings.push({
          file,
          attribute: m[0].replace(/\s+/g, ' ').trim(),
          lint,
        });
        break;
      }
    }
  }
  return findings;
}

function collectRustFiles(path: string, acc: string[]): void {
  let st;
  try {
    st = statSync(path);
  } catch {
    return;
  }
  if (st.isDirectory()) {
    if (path.endsWith('/target') || path === 'target') return;
    for (const entry of readdirSync(path)) {
      if (entry === 'target' || entry === 'node_modules') continue;
      collectRustFiles(join(path, entry), acc);
    }
  } else if (path.endsWith('.rs')) {
    acc.push(path);
  }
}

export function scanSourcePaths(paths: string[]): SuppressionFinding[] {
  const files: string[] = [];
  for (const p of paths) collectRustFiles(p, files);
  files.sort();
  const findings: SuppressionFinding[] = [];
  for (const file of files) {
    findings.push(...findBlanketSuppressions(readFileSync(file, 'utf8'), file));
  }
  return findings;
}

// Reads parsed `cargo metadata` JSON and reports every package that declares a
// non-empty cargo-machete ignore list. Absent `[package.metadata]` (null) or an
// empty `ignored` array is compliant.
export function findIgnoredDeps(metadata: unknown): IgnoredDepFinding[] {
  const findings: IgnoredDepFinding[] = [];
  if (metadata === null || typeof metadata !== 'object') return findings;
  const packages = (metadata as Record<string, unknown>).packages;
  if (!Array.isArray(packages)) return findings;
  for (const pkg of packages) {
    if (pkg === null || typeof pkg !== 'object') continue;
    const p = pkg as Record<string, unknown>;
    const meta = p.metadata;
    if (meta === null || typeof meta !== 'object') continue;
    const machete = (meta as Record<string, unknown>)['cargo-machete'];
    if (machete === null || typeof machete !== 'object') continue;
    const ignored = (machete as Record<string, unknown>).ignored;
    if (Array.isArray(ignored) && ignored.length > 0) {
      findings.push({
        package: typeof p.name === 'string' ? p.name : '<unknown>',
        ignored: ignored.map((x) => String(x)),
      });
    }
  }
  return findings;
}

function runSource(paths: string[]): number {
  if (paths.length === 0) {
    console.error(
      'ERROR: rust-policy source requires at least one path. Run: bun scripts/verify/rust-policy.ts source <crate-src-dir>...'
    );
    return 2;
  }
  const findings = scanSourcePaths(paths);
  if (findings.length === 0) {
    console.log('[rust-policy] no blanket allow/expect(warnings|clippy::all)');
    return 0;
  }
  console.error(
    'ERROR: blanket Rust lint suppression is prohibited (design D5 / G4).'
  );
  console.error(
    '  A crate/module/cfg_attr `allow|expect(warnings|clippy::all)` can absorb'
  );
  console.error(
    '  unrelated future failures while `clippy -D warnings` stays green.'
  );
  for (const f of findings) {
    console.error(`  ${f.file}: ${f.attribute}  (blanket lint: ${f.lint})`);
  }
  console.error(
    '  Fix: scope the allow to the specific named lint, or remove it.'
  );
  return 1;
}

function runMetadata(): number {
  const raw = readFileSync(0, 'utf8'); // stdin
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error(
      'ERROR: rust-policy metadata could not parse stdin as cargo-metadata JSON.'
    );
    console.error(
      '  Run: cargo metadata --no-deps --format-version 1 | bun scripts/verify/rust-policy.ts metadata'
    );
    return 2;
  }
  const findings = findIgnoredDeps(parsed);
  if (findings.length === 0) {
    console.log('[rust-policy] cargo-machete ignore lists empty');
    return 0;
  }
  console.error(
    'ERROR: non-empty cargo-machete ignore list is prohibited (design D5 / G5).'
  );
  for (const f of findings) {
    console.error(`  ${f.package}: ignored = [${f.ignored.join(', ')}]`);
  }
  console.error(
    '  Fix: remove the [package.metadata.cargo-machete] ignored entries and'
  );
  console.error('  address the flagged dependency directly.');
  return 1;
}

function main(argv: string[]): number {
  const [mode, ...rest] = argv;
  switch (mode) {
    case 'source':
      return runSource(rest);
    case 'metadata':
      return runMetadata();
    default:
      console.error(
        `ERROR: unknown mode '${mode ?? ''}'. Usage: rust-policy.ts source <path>... | metadata`
      );
      return 2;
  }
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
