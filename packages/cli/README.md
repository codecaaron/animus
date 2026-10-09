# @animus-ui/cli

Standalone Animus extraction CLI — one-shot builds and artifact emission
for any build system. `animus build` drives the same extraction session the
bundler plugins use and publishes a deterministic, fixed-path artifact set
for CI gates, non-JS orchestrators, and tooling.

If you are on a supported bundler, you want a transform driver instead:
[`@animus-ui/vite-plugin`](../vite-plugin),
[`@animus-ui/next-plugin`](../next-plugin), or
[`@animus-ui/unplugin`](../unplugin) (rollup/esbuild/rspack/webpack). The
CLI's artifacts do not transform your sources — see the
[standalone extraction contract](https://github.com/codecaaron/animus/blob/main/docs/standalone-extraction.md)
for why the transform is mandatory.

## Install

```bash
npm install --save-dev @animus-ui/cli
```

Requires Node `>=22.12.0`. Native engine binaries ship for darwin-arm64,
linux-x64-gnu, and linux-arm64-gnu; the CLI exits 3 with remediation text
on unsupported platforms.

## Usage

<!-- source lane: e2e/rollup-app/package.json `verify:build`; verified by running it in the lane (exit 0: "build complete: 10 components from 15 files") -->

```bash
animus build --root . --system ./src/ds.ts --strict
animus watch --root . --system ./src/ds.ts
animus print-config --root . --system ./src/ds.ts
```

Configuration lives in `animus.config.{json,mjs,js,ts}` (probed in that
order; `.ts` needs Node >= 23.6 native type stripping — older runtimes get
a guided error naming the `.mjs`/`.json` remedy). Flags override file
values. `--exclude` patterns join the config file's `exclude`, and together
they replace the defaults (`dist`, `.test.`, `.spec.`); an explicit
`exclude: []` in the config file means no user exclusions (the defaults are
not restored). `node_modules`, `.next` and `.animus` are always excluded.
`animus print-config` prints the fully resolved configuration as JSON on
stdout with per-key provenance, including `extensions` and `staticCss`.

Stream discipline is a contract: **stdout carries machine output only**;
every human-facing line goes to stderr.

## `--strict`

`--strict` fails the build on every diagnostic that means **a configured
input could not be read or resolved** — an include or entry that does not
resolve, a configured file that cannot be read, a configured package or
path that cannot be found, registered vocabulary that never reaches the
build. It also fails on **a classified unsupported Animus declaration**:
a declaration extraction proves comes from `@animus-ui/system` but cannot
extract, such as `.variant(AXIS)` passing a whole config through an
identifier, a member-parent `.extend()`, a default-exported chain, or a
`.props()` custom prop that loses its `transform` callback (a mutable
reference, an import from a module outside the analyzed sources or through
`export *`, or any callback reaching `.props()` through a const config), and
on a system-configured transform rejected before registration. Inside the
`.props()` object literal, an inline function and a reference to a const
arrow or function expression, a never-reassigned function declaration, a
const alias of one of these, or a const created by `createTransform`
imported from `@animus-ui/system` are supported, declared in the same module
or imported, through aliases and named re-exports, from an analyzed source
module, as is a named transform string such as `transform: 'size'`. It also fails on a value that
names no token on a strict, populated scale (`animus.props.strict-token-miss`);
that prop's styling is omitted in every mode, and the warning keeps the
authored value. It also fails on a configured transform that cannot be evaluated
during extraction (it exhausts its budget or reads the host environment) where
the value has no runtime path, in a style block, variant, state or global style
(`animus.transform.static-evaluation-unavailable`); the raw value applies in
every mode, while the same value in JSX stays on its runtime path without a
diagnostic. Each classified diagnostic carries
a stable `animus.*` code, its file and binding, the reason and a supported
rewrite. Genuine degradation stays a warning in every mode (per-property
skips, name collisions, unsupported-value fallbacks, pruning, valid dynamic
values, raw values on unscaled or `strict: false` props), and so does a declaration whose
Animus origin cannot be proven. Without `--strict` (or with `strict: false`
in the config file) all of these print as warnings and the
build exits 0.

## Exit codes

| Code | Meaning                                                                                                                                                             |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | Success — artifact set published and self-consistent                                                                                                                |
| 1    | Extraction failure (error diagnostics, `--strict` escalation, zero files, structural emptiness), or a system module that throws while loading (fatal in every mode) |
| 2    | Config/usage error (unknown key or command, unresolvable system path, `--out-dir` equal to the root, lock conflict)                                                 |
| 3    | Engine/environment failure (native engine load, consistency-check failure)                                                                                          |
| 4    | The `@animus-ui/cli` install could not be loaded (broken or partial install — reinstall)                                                                            |

Both `animus build` and `animus watch` exit 130 on SIGINT and 143 on
SIGTERM, releasing the advisory lock and keeping last-good artifacts;
`animus watch` also exits 3 under `--fail-on-degraded` when any root
cannot be watched. `animus watch` drains the in-flight cycle first; a
second signal during that drain abandons the drain and exits at once,
still releasing the lock and removing the session tree. Watch readiness is
an explicit stderr event: wait for the `watch ready` line before starting
dependent steps — it is emitted after edits observed during the first
analysis have been analyzed and published, not merely after the first pass.

Silent-empty success is impossible: system-load failure, zero discovered
files, and structural emptiness are fatal in every mode.

## Artifacts

`animus build` publishes to `--out-dir` (default `<root>/.animus/` —
`.gitignore` it) at fixed paths: `styles.css`, `system-props.js`,
`manifest.json`, and `commit.json` — written last, carrying a content hash
per payload, so one read verifies set completeness and freshness. Bytes are
deterministic and identity-free; `lock.json` is a single-writer advisory
lock that fails loud. The full contract, including the consistency-check
recipe for non-JS orchestrators, is in the
[standalone extraction contract](https://github.com/codecaaron/animus/blob/main/docs/standalone-extraction.md).

## License

MIT
