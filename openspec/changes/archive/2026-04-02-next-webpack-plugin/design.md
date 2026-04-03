## Context

The extraction pipeline is bundler-agnostic at the Rust boundary. `analyzeProject()` accepts file entries + serialized config and returns a JSON manifest. `transformFile()` accepts source + manifest and returns transformed code. Neither function knows about Vite, webpack, or any bundler.

The Vite plugin (`packages/vite-plugin/`) is the only host today. It handles: subprocess-based system loading, file discovery, virtual module CSS delivery, per-file transform, and HMR. The Next.js plugin needs the same pipeline with webpack-native lifecycle hooks.

**Current constraint:** `transform_emitter.rs` hardcodes `'@animus-ui/system'` as the runtime import source and `'virtual:animus/styles.css'` as the CSS module ID. These must be configurable before any non-Vite host can work.

**Current constraint:** Subprocess model calls `execSync('bun run ...')`. Next.js projects may not have bun installed.

## Goals / Non-Goals

**Goals:**
- Next.js App Router and Pages Router support via webpack plugin + loader
- Same extraction quality as Vite — identical NAPI calls, identical CSS output
- Consumer API: `withAnimus({ system: './src/ds.ts' })` — one function, one option
- Dev HMR with incremental re-analysis
- Runtime-agnostic subprocess (bun preferred, node fallback)
- EmitterConfig prerequisite lands in Rust, benefiting both hosts

**Non-Goals:**
- Turbopack support (no plugin API exists — explicitly deferred)
- React 19 ref-as-prop migration (separate concern, `forwardRef` + `"use client"` works today)
- Shared utilities extraction into a separate internal package (can duplicate initially, refactor later)
- Runtime package cleanup (separate change)
- SSR streaming CSS injection (Next.js handles CSS delivery via its internal pipeline)

## Decisions

### 1. Disk file vs virtual module for CSS delivery

**Decision:** Write resolved CSS to `.animus/styles.css` on disk.

**Alternatives considered:**
- `webpack-virtual-modules` — patches webpack's in-memory filesystem. Works well but adds a dependency and complexity around Next's multi-compiler (each compiler instance needs its own VirtualModulesPlugin).
- `compilation.emitAsset()` (StyleX pattern) — injects CSS as a compilation asset. Doesn't participate in the module graph, so `import './animus/styles.css'` won't resolve. Requires manual `<link>` tag injection.

**Rationale:** A real file on disk is the simplest integration point. Next.js's CSS pipeline (css-loader + mini-css-extract-plugin) processes it like any other `.css` file. No virtual module plumbing, no multi-compiler coordination for CSS content. The file is written once by the plugin, imported by the consumer in `layout.tsx` or `_app.tsx`. `.animus/` directory is gitignored.

**Trade-off:** Disk I/O on every analysis run. Mitigated by content-hash check — only write when CSS content changes.

### 2. Module-scope singleton for plugin→loader data passing

**Decision:** Module-level singleton holds analysis result. Plugin writes, loader reads.

**Alternatives considered:**
- Loader options with function reference — technically works but circumvents webpack 5's schema validation.
- `compilation.hooks` in-context data — requires the loader to access compilation internals, fragile.

**Rationale:** This is the established pattern (vanilla-extract, StyleX). The plugin and loader are `require()`d into the same Node.js process. The singleton survives across Next's 3 compiler passes, which is actually desirable — analysis runs once, all compilers share the result.

### 3. Analysis timing: once globally, not per-compiler

**Decision:** Module-level promise mutex. First compiler pass triggers analysis. Subsequent passes await the same promise.

```
const analysisPromise: Promise<Manifest> | null = null;

function getOrRunAnalysis(options): Promise<Manifest> {
  if (!analysisPromise) {
    analysisPromise = runAnalysis(options);
  }
  return analysisPromise;
}
```

Next.js calls `webpack(config, { isServer, nextRuntime })` three times: server-nodejs, server-edge, client. Each gets a fresh `compiler` instance. The analysis result is identical for all three — running it 3x wastes 3x the time.

**Trade-off:** If server and client need different emitter configs (e.g., different runtime imports), the singleton must store multiple configs keyed by target. For now, a single config suffices — the emitted `createComponent` import is the same across server and client.

### 4. Subprocess runtime detection

**Decision:** Check for `bun` in PATH. If available, use `bun run`. Otherwise, use `node` with a CJS script that `require()`s the system module.

The subprocess scripts are already CJS-compatible (`require()` + `JSON.stringify` + `fs.writeFileSync`). The only bun-specific part is the `bun run` invocation itself. Replacing with `node` is a single-line change per subprocess call.

**Implementation:** Shared utility function `execSubprocess(script, args, cwd)` that detects runtime once at plugin init and reuses the decision.

### 5. EmitterConfig threading

**Decision:** Add `emitter_config_json: Option<String>` parameter to `analyze_project()` NAPI function. The config is stored in the manifest JSON and consumed by `transform_file()`.

**Rationale:** The emitter config is a build-host concern, not a per-file concern. It's set once at analysis time and applied uniformly to all file transforms. Threading it through the manifest avoids adding parameters to `transform_file()`.

**Vite backward compatibility:** When `emitter_config_json` is `None`, the Rust crate uses hardcoded defaults (`@animus-ui/system`, `virtual:animus/styles.css`). Existing Vite plugin code continues to work without changes until it opts into explicit config.

### 6. Loader placement in webpack rule chain

**Decision:** The Animus loader runs AFTER Babel/SWC (Next.js default loaders) in the rule chain. It processes already-transpiled JS/TS, not raw source.

**Wait — correction:** The loader must run BEFORE Babel/SWC, because it needs to see the original builder chain syntax (`.styles().variant().asElement()`). After Babel, the chain may be transformed.

Actually: `transformFile()` uses OXC to re-parse and find chains by binding name, then replaces spans. It works on the ORIGINAL source, not transpiled output. So the loader must see the original `.tsx` source.

**Decision (revised):** Loader runs BEFORE Next.js default loaders. In webpack rule config, it's added as a pre-loader or with `enforce: 'pre'`.

## Risks / Trade-offs

**[Multi-compiler CSS timing]** → The plugin writes CSS to disk during the first compiler pass. If a subsequent compiler pass runs concurrently and the consumer imports the CSS file, it must exist on disk before that import is resolved. **Mitigation:** The promise mutex ensures analysis (and CSS write) completes before any compiler pass proceeds to module resolution.

**[Disk write in CI]** → Writing `.animus/styles.css` to the project directory may cause issues in read-only CI environments or when the source directory is mounted read-only. **Mitigation:** Document that `.animus/` must be writable. Add `.animus/` to `.gitignore` template. Consider falling back to `node_modules/.cache/animus/` if `.animus/` is not writable.

**[Loader ordering with other plugins]** → If the project uses other source-transforming webpack plugins (e.g., `next-intl`, `next-mdx`), the Animus loader must run before them to see unmodified source. **Mitigation:** Use `enforce: 'pre'` to ensure early execution. Document loader ordering requirements.

**[Node.js subprocess fallback performance]** → `node` subprocess startup is slower than `bun` (~200ms vs ~30ms). For large projects with many global style blocks, this adds up. **Mitigation:** The subprocess runs once per build (or geological reset). The ~170ms difference is negligible relative to total build time.

**[OXC version coupling]** → The Rust crate pins OXC at 0.121.0. If Next.js source uses syntax from a newer TS/JS version that OXC 0.121.0 doesn't support, chain detection may fail silently. **Mitigation:** OXC 0.121.0 supports all stable TypeScript 5.x syntax. Document the supported syntax level.
