# Standalone extraction — the consumer contract

How to use Animus outside the Vite and Next.js plugins: the
`@animus-ui/unplugin` transform host (rollup, esbuild, rspack, webpack) and
the `animus` CLI (CI gates, non-JS orchestrators, tooling). This page is the
contract for both — module resolution, the dev-signal define, the artifact
set, exit codes, and platform support.

## Pick your driver

| You are building with            | Use                                                     |
| -------------------------------- | ------------------------------------------------------- |
| Vite                             | [`@animus-ui/vite-plugin`](../packages/vite-plugin)     |
| Next.js (webpack or Turbopack)   | [`@animus-ui/next-plugin`](../packages/next-plugin)     |
| rollup, esbuild, rspack, webpack | [`@animus-ui/unplugin`](../packages/unplugin)           |
| CI gates, non-JS build systems   | `animus build` from [`@animus-ui/cli`](../packages/cli) |

The root export of `@animus-ui/unplugin` is an unplugin instance, and
unplugin instances expose a reachable `.vite` adapter. That adapter is
**unsupported** — Vite users use `@animus-ui/vite-plugin`, which owns dev
serving, HMR, and the virtual stylesheet. The supported surface of
`@animus-ui/unplugin` is exactly the four subpath entries: `/rollup`,
`/esbuild`, `/rspack`, `/webpack`.

## The integration is a transform, not a stylesheet

Every Animus integration does two inseparable things:

1. **Source transforms** — builder chains compile to `createComponent()`
   calls carrying the extracted class names.
2. **Stylesheet delivery** — the extracted CSS reaches the page.

There is no stylesheet-only integration. If your bundler ships untransformed
sources, components construct with an **empty base class**: variant classes
match nothing, every system prop drops, and the app renders **fully
unstyled**. In production bundles there is **no warning** — the runtime's
dev diagnostics sit behind the `__ANIMUS_DEV__` define, which no plugin-less
bundle supplies, so the failure is silent and CI stays green. This is why no
aliasing-only recipe appears anywhere in these docs: aliasing
`@animus-ui/system` paths without running the transform is a broken build
that looks like a working one.

## Quickstart: rollup

The reference integration is the repo's own end-to-end lane,
`e2e/rollup-app` — every snippet below is lifted from it and runs in CI.

Install the host next to your existing rollup toolchain:

<!-- source lane: e2e/rollup-app/package.json (dependencies/devDependencies); verified by the lane's `vp run @animus-ui/rollup-app#verify` claim -->

```bash
npm install --save-dev @animus-ui/unplugin rollup rollup-plugin-esbuild @rollup/plugin-node-resolve @rollup/plugin-commonjs
npm install @animus-ui/system react react-dom
```

Configure rollup — the Animus host **must be listed before the
transpiler** (see [Plugin ordering](#plugin-ordering) below):

<!-- source lane: e2e/rollup-app/rollup.config.mjs (lane-specific root/exclude pinning and output names removed); verified twice by running against the lane sources: the lane config itself (exit 0, dist/bundle.mjs + dist/animus.css) and this exact shape with only the lane-forced deltas (exclude: ['fixtures/**'] because the lane carries negative fixtures; scratch output dir) — exit 0, animus.css emitted -->

```js
// rollup.config.mjs
import { animusRollup as animus } from '@animus-ui/unplugin/rollup';
import commonjs from '@rollup/plugin-commonjs';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import esbuild from 'rollup-plugin-esbuild';

export default {
  input: 'src/entry.tsx',
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  plugins: [
    // The host FIRST: its transform must see raw TSX (rollup has no
    // enforce ordering — config order is the law).
    animus({
      system: './src/ds.ts',
      strict: true,
      mode: 'production',
    }),
    esbuild({ jsx: 'automatic', target: 'es2022' }),
    nodeResolve({ extensions: ['.mjs', '.js', '.ts', '.tsx'] }),
    commonjs(),
  ],
  output: { dir: 'dist', format: 'esm' },
};
```

Import the stylesheet id once from your entry module — the host resolves it
in-process and delivers the CSS as a real emitted asset:

<!-- source lane: e2e/rollup-app/src/entry.tsx; verified by the same lane rollup run and by scripts/assert-host.mjs (rendered classes ⊆ emitted sheet) -->

```tsx
// src/entry.tsx
import '.animus/styles.css';
```

Build, then wire the emitted asset into your page:

<!-- source lane: e2e/rollup-app/package.json `verify:build` script; verified by running `animus build --root . --system ./src/ds.ts --strict --exclude 'fixtures/**'` (exit 0) and `rollup -c rollup.config.mjs` (exit 0) in the lane -->

```bash
npx rollup -c rollup.config.mjs
# dist/ now contains your bundle plus animus.css — link it in your HTML:
#   <link rel="stylesheet" href="/dist/animus.css" />
```

The host runs the one extraction session at `buildStart` inside your
bundler's process. Analysis failure is build failure — never a passthrough
— and a build that discovers zero source files fails loudly naming the
effective root and exclusions.

### Config spellings: ESM vs CJS

The host ships dual-format with a CJS default export on every subpath
(node16 interop shape). The two sanctioned spellings:

<!-- source lane: e2e/rollup-app/rollup.config.mjs (ESM form); both forms verified by running them under node from the lane: `import { animusRollup }` and `require('@animus-ui/unplugin/rollup').default` each yield a function -->

```js
// ESM config files: use the NAMED export.
import { animusRollup } from '@animus-ui/unplugin/rollup';
// (animusEsbuild, animusRspack, animusWebpack on their subpaths.)

// CJS config files: use `.default`.
const animus = require('@animus-ui/unplugin/rollup').default;
```

A Node-ESM **default** import of the CJS build binds the exports _object_,
not the plugin function — in ESM configs, always use the named export.

### Plugin ordering

The extraction engine parses **raw TSX** — the host's transform must run
before any TS/JSX transpilation. `@animus-ui/unplugin` registers itself
`enforce: 'pre'`, which orders webpack and rspack loader chains
automatically. **rollup has no enforce ordering: config order is the law** —
list the Animus plugin before `rollup-plugin-esbuild`, `@rollup/plugin-babel`,
`@rollup/plugin-typescript`, or any other transpiler.

The mis-ordering symptom is distinctive: a source-drift warning on stderr —

```
v2: transform-time source for <file> differs from analyze-time source — an upstream transform may be reverted
```

— followed by a parse error from the bundler (the transform's TSX output
reaches a stage that no longer understands TSX). The fix is always the
same: move the Animus plugin ahead of the transpiler.

## Module resolution: the three id families

Extraction rewrites your sources against three module-id families. The host
applies all three automatically; they are listed here so you know what your
bundle contains — and what a hand-rolled host must replicate.

1. **The stylesheet id** — `.animus/styles.css`. Transformed modules import
   it (and your entry should too). The host resolves it to an in-process JS
   stub; the CSS itself is delivered as the emitted `animus.css` asset,
   never as a module.
2. **The system-props id** — `virtual:animus/system-props`. The emitted
   runtime module carrying the system-prop lookup tables, served from
   retained engine state.
3. **Per-kit specifier redirects** — one redirect per admitted design-system
   kit specifier (e.g. `@acme/kit`) to the **exact source entry extraction
   analyzed**, so the kit's components arrive transformed instead of as
   published dist files that never met the engine.

Hand-wiring these yourself is the escape hatch, not the product, and only
the first two ids are static. The kit redirects are **computed data**: they
come from the extraction session's discovery output (the
`ExtractionSession.externalSourceEntries` map — specifier → absolute
analyzed entry), which no README can enumerate. tsconfig `paths` are the
host's alias source (there is no live bundler alias surface across four
bundlers), so keep your aliases there.

## The `__ANIMUS_DEV__` define contract

The system runtime's development-only diagnostics (the drop diagnostic, the
reachability witness) key on one bare token: `__ANIMUS_DEV__`. The contract
for any host, including a hand-rolled one:

- Supply a **boolean define** for the bare token: `true` in development,
  `false` in production. `@animus-ui/unplugin` does this through esbuild's
  `define`, webpack/rspack's `DefinePlugin`, and (for rollup)
  assignment-guarded token substitution in the transform.
- The token is read as `typeof __ANIMUS_DEV__ === 'boolean' ? __ANIMUS_DEV__
: …` — so a bundle **without** the define does not crash; it silently
  loses every dev diagnostic. That silence is exactly how an untransformed
  app ships unstyled with green CI, which is why supplying the define is a
  host obligation, not an optimization.
- With the define supplied, production builds constant-fold the token and
  the minifier drops every dev-only branch and diagnostic string from the
  bundle.

## The `mode` option selects emission only

`mode: 'development' | 'production'` controls **emission decisions only**:
the minify default, the `__ANIMUS_DEV__` define value, and the engine's
dev-diagnostics mode. It never controls process lifecycle — watchers, HMR,
and serve behavior stay on each host's own signals.

Defaults when `mode` is absent:

- **CLI**: `production`, always. The CLI never sniffs `NODE_ENV`.
- **Host**: the bundler's own command oracle where one exists — webpack and
  rspack `compiler.options.mode`, rollup watch mode — else `production`
  (esbuild exposes no signal to plugins).

An explicit `mode` wins over every bundler signal. Invalid values fail loud
at intake.

## The CLI: `animus build`, `animus watch`, `animus print-config`

`@animus-ui/cli` (bin: `animus`) drives the same extraction session
one-shot and publishes a deterministic artifact set for consumers that are
not JS bundlers: CI gates, Makefiles, non-JS build orchestrators, tooling.

<!-- source lane: e2e/rollup-app/package.json `verify:build` script; verified by running it in the lane (exit 0: "build complete: 10 components from 15 files") -->

```bash
npx animus build --root . --system ./src/ds.ts --strict
```

Configuration lives in `animus.config.{json,mjs,js,ts}` (probed in that
order under the root) with flags overriding file values; run
`animus print-config` to see the fully resolved configuration — it prints a
single JSON document on stdout with per-key provenance. Stream discipline
is a contract: **stdout carries machine output only**; every human-facing
line goes to stderr.

### Exit codes

<!-- source lane: e2e/rollup-app/scripts/assert-artifacts.mjs (exit-taxonomy negatives); verified by running the script (all assertions passed) and directly: missing --system exits 2 -->

| Code | Meaning                                                                                                                                           |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | Success — the artifact set is published and self-consistent                                                                                       |
| 1    | Extraction failure: error-kind diagnostics, `--strict` escalations, zero discovered files, structural emptiness, system-module evaluation failure |
| 2    | Config/usage error: unknown option key, unresolvable `--system` path, unknown command, another process holds the artifact lock                    |
| 3    | Engine/environment failure: native engine failed to load, published set failed its own consistency check                                          |

`animus watch` adds: **130** on SIGINT, **143** on SIGTERM (lock released,
last-good artifacts kept), and **3** when `--fail-on-degraded` is set and
any root cannot be watched.

Silent-empty success is impossible in every mode: system-load failure, zero
discovered files, and structural emptiness (empty component CSS, missing
`:root`, broken layer order, placeholder residue) are fatal regardless of
`--strict`. Per-specifier discovery outcomes (`resolved | unresolvable |
empty | stale-dist`) and never-matching exclusion patterns are reported on
stderr; `--strict` escalates warnings to failures.

### `animus watch`

Long-lived republish-on-change over the same writer path as `build`. Its
readiness signal is an explicit stderr event — wait for it before starting
dependent steps:

<!-- source lane: e2e/rollup-app (watch run against the lane fixture); verified by running `animus watch --root . --system ./src/ds.ts --exclude 'fixtures/**'`: the line below appeared, and SIGINT exited 130 with "watch shutdown reason=SIGINT" -->

```
[animus] watch ready components=10 files=15 outDir=/path/to/app/.animus
```

Mid-run failures keep the last-good artifact set and report per-cycle on
stderr. The advisory lock is held for the watch's lifetime, so a concurrent
`animus build` against the same outDir fails loud instead of racing.
Unwatchable roots (e.g. kit sources resolved through `node_modules`) are
named in a persistent warning at every publication; pass
`--fail-on-degraded` to exit 3 instead of running degraded.

## The artifact contract

`animus build` publishes to `outDir` (default `<root>/.animus/`) at fixed
relative paths:

| File              | Contents                                                       |
| ----------------- | -------------------------------------------------------------- |
| `styles.css`      | The extracted stylesheet (`@layer`-structured)                 |
| `system-props.js` | The emitted system-props runtime module                        |
| `manifest.json`   | The analysis manifest (components, class names, report)        |
| `commit.json`     | The commit record — written **last**, content hash per payload |
| `lock.json`       | Single-writer advisory lock — present only while a run is live |

Artifact bytes are deterministic and identity-free: identical inputs produce
byte-identical trees, with no session envelope or per-run identity in any
payload. The commit record (`schema: 1`, MD5 content hashes) is the
freshness and consistency witness: because it is written last, a reader
that verifies every payload hash against it knows the set is complete and
mutually consistent in one read.

For non-JS orchestrators, the check is a few lines of stock Node (the same
check the CLI runs against its own output before exiting 0):

<!-- source lane: mirrors e2e/rollup-app/scripts/assert-artifacts.mjs § "commit hash verifies" (contentHash = md5 hex); verified by running this exact command against the lane's published .animus/ (exit 0, "artifact set consistent") -->

```bash
node -e '
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const dir = process.argv[1];
const commit = JSON.parse(readFileSync(`${dir}/commit.json`, "utf-8"));
for (const [name, { hash }] of Object.entries(commit.payloads)) {
  const actual = createHash("md5").update(readFileSync(`${dir}/${name}`)).digest("hex");
  if (actual !== hash) { console.error(`${name}: stale or corrupt`); process.exit(1); }
}
console.error("artifact set consistent");
' .animus
```

The lock fails loud: a second writer against a live outDir exits 2 naming
the holding pid and start time; a lock left by a dead process is stolen
loudly. A `sessions/` directory may appear under the outDir while a watch
or host build is live — it is session-scoped scratch, cleaned up on
completion, and never part of the published contract.

**`.gitignore` the outDir.** The artifact set is build output:

<!-- source lane: e2e/rollup-app/.gitignore; verified by reading the lane file -->

```gitignore
.animus/
```

The outDir is force-excluded from source discovery regardless of your
exclude configuration, so publishing into the tree you extract from cannot
self-ingest.

## CI recipe

Gate merges on a strict one-shot build; script against the exit codes and
the commit record, never against stderr prose:

<!-- source lane: e2e/rollup-app/package.json `verify:build` + scripts/assert-artifacts.mjs; verified by running the build (exit 0) and the consistency check above (exit 0) in the lane -->

```bash
set -e
npx animus build --root . --system ./src/ds.ts --strict
# Exit 0 guarantees: artifact set published, self-check passed, no
# silent-empty output. 1 = extraction failure, 2 = config error,
# 3 = engine/environment failure.
```

Downstream steps that consume the artifacts should re-run the
commit-record consistency check (previous section) at their point of use —
that is the freshness contract for orchestrators that cannot share a
process with the CLI.

## Platform support and Node floor

Prebuilt native engine binaries ship for:

- `darwin-arm64` (macOS Apple Silicon)
- `linux-x64-gnu` (Linux x64, glibc)
- `linux-arm64-gnu` (Linux ARM64, glibc)

No musl, win32, or darwin-x64 binaries exist today; expansion is
demand-driven. On an unsupported platform the engine fails to load and the
CLI exits 3 with the loader's remediation text — there is no silent
degradation.

The Node floor is **`>=22.12.0`**, declared in the `engines` field of every
published `@animus-ui/*` package. One narrower requirement:
`animus.config.ts` files load through Node's native type stripping, which
requires **Node >= 23.6** unflagged — on older runtimes the CLI raises a
guided config error naming the remedy (`animus.config.mjs` or
`animus.config.json`).

## Changed plugin behavior (release-notes callout)

The shared option core that made the standalone drivers possible also
changed two observable behaviors in the existing Vite and Next plugins:

- **`exclude` is now glob-aware; a user list still REPLACES the
  replaceable defaults.** The dialect is closed: `**` spans segments, `*`
  and `?` stay within one segment, no character classes or braces; a
  leading `./` is equivalent to the bare root-relative path; metachar-free
  patterns keep substring compatibility. Supplying `exclude` replaces the
  replaceable defaults (`dist`, `.test.`, `.spec.`) — the historical
  contract — while the structural exclusions (`node_modules`, `.next`,
  `.animus`) always apply and cannot be re-admitted: `node_modules` is
  owned by the external-package collection path, and the artifact output
  directories must never be re-ingested as source. Vite consumers gained
  the `.next`/`.animus` structural exclusions in this unification.
- **The new `mode` key selects emission only** (minify default,
  `__ANIMUS_DEV__` define, engine dev diagnostics) — process lifecycle
  (dev server, HMR, watchers) stays on each bundler's own signals, exactly
  as before.
