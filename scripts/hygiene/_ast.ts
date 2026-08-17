// scripts/hygiene/_ast.ts
//
// Shared oxc-parser view used by the two hygiene passes that walk source
// ASTs: `delete-unused.ts` (Layer C, intra-file dead declarations) and
// `reconcile-after-knip.ts` (Layer D1, stale barrel re-exports).
//
// oxc-parser replaces the former `typescript5` alias: the canonical toolchain
// (typescript@7, native) ships no JS compiler API, and these layers need an
// in-process AST surface. oxc-parser emits a TS-ESTree AST (`parseSync` →
// `{ program, errors, comments }`) with trivia-exclusive `start`/`end` spans.

/**
 * Minimal structural view of an oxc ESTree node. oxc nodes carry no `parent`
 * back-link (unlike the TS AST); passes that need one wire it themselves onto
 * a non-enumerable `parent` slot after parse.
 */
export type Node = {
  type: string;
  start: number;
  end: number;
  parent?: Node;
  // Children are navigated structurally; the index signature keeps that
  // ergonomic without enumerating every ESTree field.
  // oxlint-disable-next-line no-explicit-any
  [key: string]: any;
};

/**
 * oxc deduces the dialect from the filename extension. Hygiene only ever sees
 * TypeScript, and test fixtures use non-standard extensions (`*.ts.in`), so
 * the dialect is passed explicitly: JSX-bearing files by extension,
 * everything else as `ts`. This guarantees TS syntax (overload signatures,
 * `namespace`, type annotations) parses regardless of the on-disk extension.
 */
export function langFor(filename: string): 'ts' | 'tsx' | 'js' | 'jsx' {
  if (filename.endsWith('.tsx')) return 'tsx';
  if (filename.endsWith('.jsx')) return 'jsx';
  if (
    filename.endsWith('.js') ||
    filename.endsWith('.mjs') ||
    filename.endsWith('.cjs')
  ) {
    return 'js';
  }
  return 'ts';
}
