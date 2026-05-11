# Code-hygiene corner-case fixtures

Adversarial-corner-case fixtures for the home-roll deleter (Layer C) and the
post-knip reconciler (Layer D1). Each fixture is a small TypeScript source
exhibiting a known-tricky shape (overloaded functions, JSDoc trivia,
namespace declarations, mixed type/value re-exports). Tests in the sibling
`*.test.ts` files load these fixtures and assert the expected post-cascade
shape.

Layout:

- `reconciler/<scenario>.ts.in` — barrel source (re-exports). Tests pair the
  barrel with a synthetic target module whose actual exports are constructed
  inline; the reconciler uses the target to detect stale re-exports and
  applies span-preserving deletions to the barrel.
- `deleter/<scenario>.ts.in` — TypeScript source containing dead declarations.
  Tests parse synthetic oxlint JSON pointing at the dead-decl coordinates and
  assert the deleter removes the right span without orphaning surrounding
  trivia.
