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
animus prop-order --root . --system ./src/ds.ts
```

`animus prop-order` writes only `<root>/.animus/prop-order.json`. The
[`animus/prop-order` lint rule](../extract/README.md#prop-order-lint-rule)
reads it, and the command needs no dev server; `animus build` writes the
same file when the config sets `propOrderFile: true`.

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

## `animus css audit`

```bash
animus build --root . --system ./src/ds.ts --verbose
animus css audit --root . --dist dist
```

A report of what would make the shipped CSS smaller, ranked by measured
savings. It reads a full manifest (`--manifest`, default `manifest.json` in
the artifact directory `animus build` uses, so `--out-dir`, `cli.outDir`,
`--config` and `--root` apply as they do there) and the built output
(`--dist`, default `<root>/dist`), and writes nothing. The manifest must
come from the build that produced the output: `animus build --verbose`
with the same settings, or one a host captured. Each estimate edits the
shipped CSS and recompresses each file on its own (gzip level 9, Brotli
quality 11 with a 22-bit window); Brotli ranks them.

1. **Delivery:** whether `stylesheets: 'split'` with
   `removeUnbundledComponents`, options of the Vite plugin only, would cost
   or save bytes for this app, with the preconditions to check. Output
   whose Animus CSS carries no `@layer anm-…` block (unlayered or
   polyfilled) is not estimated.
2. **Slot keepers:** the system props that keep a runtime slot, grouped by
   the rule that keeps them, with the components and sites that keep them.
3. **Restructures** saving at least 0.25% of the CSS's Brotli size: unused
   variant options a dynamic site keeps, extensions that only change
   defaults, and base blocks several components repeat. Each has a
   confidence and the cases it refuses; the rest are listed collapsed.
   Unused options are always low confidence: the manifest records no
   spread at a site and no value forwarded from a parameter, so a wrapper
   may still reach them.

The text report goes to stderr; `--json` prints the report as one JSON
document on stdout. It exits 0 unless its input cannot be read: a missing
or partial manifest, one whose classes the output's CSS never names, or an
output file it cannot read, each exit 2 with the remedy.

## `animus types alias`

```bash
animus types alias .types-raw --out types \
  --project tsconfig.types.json --probes type-probes
```

Turns ordinary compiler declaration output (`tsc` with `declaration` and
`emitDeclarationOnly`) into a packet for consumers to type-check against.
It infers nothing: the compiler's declarations are the contract. Inferred
component declarations spell each system's prop and group registries out
in full, many times per component; the command finds each system
declaration (`export declare const ds: SealedSystemInstance<…>` from
`@animus-ui/system`), and replaces every structurally identical registry
subtree elsewhere with an alias in an isolated helper module,
`__animus_registry__.d.ts`, which reads the type back from that
declaration. Two subtrees match only when their structure, modifiers, literals and key
kinds are equal and every name in them resolves to the same declaration:
the same packet file, or the same physical package directory seen in the
same module mode (an ESM and a CommonJS view never match). Printed text and
assignability are never the test. A subtree the matcher cannot resolve
stays as emitted, and so are, each with a warning: a file whose aliases
would bring an augmentation (a `declare module`/`declare global` block, a
script declaration file or a `/// <reference lib>`) into a public entry
that does not already load it; a file with an import that carries
attributes or a `resolution-mode`; and an occurrence that names a
declaration of its own file. When an import with attributes or a
`resolution-mode` sits anywhere an anchor reaches, nothing is aliased in
that run. On the benchmark's 1,000-component app the
declarations shrink from 94.6 MB to 2.1 MB.

One run owns `--out` at a time, through a `.<out>.lock` file beside it. A
lock is never taken over: a run killed before it released its lock leaves
it behind, and the next run refuses (exit 2) and names it; delete it once
no run is active. The
packet is written to a staging directory beside `--out` and promoted only
when every check passes and the declaration output still has the
fingerprint it was built from; on any failure `--out` is left exactly as it
was and the command exits non-zero. The checks:

1. Every packet file type-checks with `skipLibCheck: false` under the
   `--project` compiler options, and each alias is the same type as a
   literal it replaced, once per directory and module flavor.
2. The probe files in `--probes` are checked twice, against the compiler's
   declarations and against the packet. Each run sees a copy of the package
   whose `--out` is that route's declarations, and imports the package by
   name, so tsc resolves it through the package's real `exports`. A probe
   may import other TypeScript files in `--probes`; any other relative
   import is refused. Both
   must report the same diagnostics at the same sites, and neither may
   load a package file outside its route.

The command refuses an `exports` entry whose first matching condition
selects a file outside `--out` before its `types` condition reaches the
packet, a subpath whose `import` and `require` routes select different
packet files (the probes check one), and a `types` target the packet does
not contain. `--out` is replaced only when it is missing or holds the
`__animus_packet__.json` manifest a previous run wrote, checked again just
before the swap. `--anchor
<module>#<export>` adds a system declared outside the packet, such as a UI
package's components built on another package's `ds`
(`--anchor @acme/styles#ds`). Declaration maps follow the rewrite. With
`--json` the report is one JSON document on stdout; otherwise a summary
goes to stderr. Its `skipped` list names system declarations whose
registries were not aliased, such as an empty sealed system, and its
`warnings` list names files left as emitted and entries that miss an
augmentation; neither changes the exit code. Exit codes: 0 promoted; 1 a check failed or the
declarations could not be read; 2 a usage error (a missing directory, an
`--out` the command did not write or another run owns, a refused `exports`
route); 3 no TypeScript.

The packet is a type contract only: extraction never reads it, and a
TypeScript annotation never decides what CSS ships.

### Package recipe

The package build owns freshness: emit, alias, validate and promote run as
one failing chain, so an old packet can never stand for a new success.

```jsonc
// package.json
{
  "exports": {
    ".": { "types": "./types/index.d.ts", "import": "./dist/index.js" },
    "./tokens": {
      "types": "./types/tokens.d.ts",
      "import": "./dist/tokens.js",
    },
  },
  "files": ["dist", "types"],
  "scripts": {
    "build:types": "rm -rf .types-raw && tsc -p tsconfig.types.json && animus types alias .types-raw --out types --project tsconfig.types.json --probes type-probes",
  },
}
```

```jsonc
// tsconfig.types.json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "declaration": true,
    "emitDeclarationOnly": true,
    "declarationMap": true,
    "noEmitOnError": true,
    // Inherited build state would let a rebuild skip emitting into the
    // freshly removed output directory.
    "incremental": false,
    "composite": false,
    "outDir": "./.types-raw",
    "rootDir": "./src",
  },
  "include": ["src"],
}
```

- **Route every public type subpath to the packet.** Each `exports` entry
  that consumers type-check against gets a `types` condition inside
  `--out`; runtime and extraction entries stay as they are. A consumer
  that reaches the package's source through a relative import, a `paths`
  alias or an editor redirect bypasses the packet and checks the builders
  again.
- **Keep an explicit augmentation edge in every type entry.** A component's
  inferred declaration inlines what it read from the module that augments
  `Theme` (or `Selectors`, `Conditions`), so tsc drops that import, and a
  consumer of the entry would check against an unaugmented theme. tsc
  keeps a type-only re-export, and it has no runtime effect:

  ```ts
  // src/index.ts
  export type {} from './theme-augmentation';
  export * from './components';
  ```

  The command warns about an entry that does not reach a module
  augmentation in the packet, or an augmentation of `@animus-ui/system` in
  a package an anchor names (a UI package's theme lives in its foundation), and leaves a file as emitted when an entry
  that reaches it would gain an augmentation from an alias.

- **Fail closed.** `rm -rf .types-raw` and `noEmitOnError` mean a failed
  compile leaves nothing to alias, `&&` stops the chain there, and the
  command promotes only a packet that passed its checks. Make consumers'
  type checks depend on this script in the task graph (for turbo,
  `"typecheck": { "dependsOn": ["^build:types"] }`), and key any build
  cache on the compiler, its options and every input the producer reads,
  augmentation files included.
- **Probes are consumer code.** Put files in `type-probes/` that import the
  package by name, as a consumer does: accepted uses and deliberate
  mistakes (a wrong variant, an unknown breakpoint), with no
  `@ts-expect-error`. Make the augmentation visible through rejections:
  without it, Animus props fall back to permissive CSS types and accept
  any value, so an accepted theme token proves nothing. Include wrong
  token values the augmented theme rejects (an unknown color token, an
  unknown breakpoint); a lost augmentation edge then makes those
  rejections disappear.
- **Ignore the intermediates:** `.types-raw/`, `types/`, `.types.lock`,
  and the `.types.staging-*`, `.types.check-*` and `.types.retired-*`
  directories a run leaves only if it is killed. The next run removes the
  directories; it refuses a leftover lock, which you delete.

What can still go stale: a consumer check that bypasses the build, a
stopped watch, an editor holding unsaved builder edits, or a cache restoring
`types/` under a key that misses an input. The packet does not make a clean
source check free: the producer still checks every builder once.

The packet matches the compiler's declaration output, which can check
differently from source. For example, an entry whose emitted declarations
reference `import("./index.ts")` reaches that module's augmentation, though
its source never imports it, so a consumer of that entry is stricter against
both the declarations and the packet than against source.

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
`manifest.json`, `font-preloads.json` (the font faces' preloads, for
`renderFontPreloads`; present only when a face preloads, as the faces'
`preload` flags or the config's `fontPreloads` entries select them), and
`commit.json` — written last, carrying a content hash
per payload, so one read verifies set completeness and freshness. Bytes are
deterministic and identity-free; `lock.json` is a single-writer advisory
lock that fails loud. The full contract, including the consistency-check
recipe for non-JS orchestrators, is in the
[standalone extraction contract](https://github.com/codecaaron/animus/blob/main/docs/standalone-extraction.md).

With `stylesheets: 'split'` in the config, the build also publishes
`styles.css` as consecutive slices, `styles.<slice>.<hash>.css` for the
foundation, components and utilities, and `stylesheets.json`, their names in
the order a document links them. Their bytes in order are `styles.css`'s, so
linking them in that order changes nothing in the cascade, and a slice an
edit leaves alone keeps its name and its cached copy. `commit.json` lists
them with the rest.

## License

MIT
