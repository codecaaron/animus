# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## Unreleased

**Peer-range clamps (breaking for consumers on unproven majors).** Host
peer ranges now match the versions our blocking fixtures actually prove:

- `@animus-ui/vite-plugin` peers `vite: ">=8 <9"` (was `>=5.0.0`)
- `@animus-ui/next-plugin` peers `next: ">=15 <16"` (was `>=14.0.0`) —
  Next 16 (Turbopack-default) stays excluded until a blocking fixture
  exercises that exact build mode

Consumers on other majors should stay on earlier plugin releases; a major
is re-admitted when a blocking fixture proves it.

**Packaging fixes** (caught by the new packed-artifact verification lane):

- `@animus-ui/next-plugin` is now CJS-only with a consistent exports map
  (types previously resolved as CJS under the `import` condition)
- `@animus-ui/vite-plugin` now declares a proper `exports` map
- `@animus-ui/extract` ships type declarations for the `./engine-v2`
  subpath and format-consistent `./pipeline` entries

## 0.1.0 (2026-05-11)

First release of the new Animus package architecture:

- `@animus-ui/properties` — prop registry and style-prop definitions
- `@animus-ui/system` — component builder, theme construction, runtime
- `@animus-ui/extract` — Rust-based static CSS extraction pipeline (NAPI)
- `@animus-ui/vite-plugin` — Vite integration for static extraction
- `@animus-ui/next-plugin` — Next.js integration for static extraction

Supersedes the 2022 `@animus-ui/core` / `theming` / `components` line (archived under `legacy/`).

## [0.1.1-beta.1](https://github.com/codecaaron/animus/compare/v0.1.1-beta.0...v0.1.1-beta.1) (2022-01-09)

**Note:** Version bump only for package root

## 0.1.1-beta.0 (2022-01-09)

**Note:** Version bump only for package root
