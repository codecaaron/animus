# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## Unreleased

**Invalid transform results are now rejected instead of silently
stringified (headline behavior change).** A prop `transform` must return a
`string` or a finite `number`. Every other shape — object, array, function,
`null`, `undefined`, boolean, symbol, bigint, `NaN`, `±Infinity` — is now
rejected on both
resolution paths (a build failure statically, a dropped value dynamically)
instead of being coerced with `String(...)`:

- **Static (build).** Extraction emits no declaration for the offending prop
  and records an error diagnostic; the Vite and Next plugins fail the build,
  listing every occurrence:

  ```
  [animus] <component> (<file>): transform '<name>' returned <shape> for prop '<prop>' — transforms must return a string or finite number; rule-level styling ships as declaration scales (see composite-style-scales)
  ```

- **Dynamic (browser).** The whole prop value is dropped atomically — every
  breakpoint of a responsive value, no slot class and no variable writes —
  with a once-per-class/prop dev warning. Production drops quietly.
- **Throwing transforms** keep their existing raw-value fallback, but the
  fallback is now reported as a warning diagnostic instead of being silent.

Previously these results reached the stylesheet as text like
`[object Object]`: invalid CSS, an unstyled element, and no diagnostic on
either path. Valid results are untouched — emitted CSS and variable values
are byte-identical.

_Migration._ This includes objects whose `toString` yields valid CSS text —
boxed primitives, Dates, RegExps, and custom CSS-value classes — which the
old coercion silently accepted, and `bigint` results (previously stringified
like `10n` → `"10"`): return the plain string or number instead. Object
returns were live behavior in the legacy Emotion runtime
(`legacy/core`), where the returned object merged into the rule. The
extraction rewrite dropped that behavior at build time and only the type
survived, so a migrated object-returning transform has been producing silent
garbage; it now fails loudly. Rewrite such transforms to return a single CSS
value — rule-level styling (one prop writing several declarations) arrives as
declaration scales in an upcoming release. The public type
surface is unchanged in this release: `TransformFn` and
`CustomPropConfig.transform` keep the wide `string | number | CSSObject`
union, now documented as deprecated on the `CSSObject` arm; narrowing lands
in the next breaking release. Rollback is a version revert — there is no
config or data migration.

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
