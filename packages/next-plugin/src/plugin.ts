import {
  assertNoRetiredEngineSelection,
  buildPathAliasesJson,
} from '@animus-ui/extract/pipeline';
import { join } from 'path';

import { ANIMUS_CSS_MODULE_ID, ExtractionSession } from './extraction-session';
import {
  getAnalysisPromise,
  getSharedCss,
  getSharedExternalDirs,
  getSharedExternalEntries,
  setAnalysisPromise,
  setSharedEngine,
} from './singleton';

import type { AnimusNextOptions } from './types';

export { ANIMUS_CSS_MODULE_ID } from './extraction-session';

type WebpackSource = {
  source(): string | Buffer;
  size(): number;
};

type Compilation = {
  hooks: {
    processAssets: {
      tap: (
        options: { name: string; stage: number },
        fn: (assets: Record<string, WebpackSource>) => void
      ) => void;
    };
  };
  getAsset(name: string): { source: WebpackSource } | undefined;
  updateAsset(name: string, newSource: WebpackSource): void;
};

type Compiler = {
  hooks: {
    run: {
      tapPromise: (name: string, fn: (c: Compiler) => Promise<void>) => void;
    };
    watchRun: {
      tapPromise: (name: string, fn: (c: Compiler) => Promise<void>) => void;
    };
    compilation: {
      tap: (name: string, fn: (compilation: Compilation) => void) => void;
    };
  };
  context: string;
  /** Present on watchRun compilers after the first compilation (webpack 5). */
  modifiedFiles?: ReadonlySet<string>;
  removedFiles?: ReadonlySet<string>;
  options?: {
    name?: string;
    resolve?: {
      alias?: Record<string, string | string[] | false>;
    };
  };
  webpack?: {
    Compilation: {
      PROCESS_ASSETS_STAGE_ADDITIONAL: number;
    };
    sources: {
      RawSource: new (source: string) => WebpackSource;
    };
  };
};

const PLUGIN_NAME = 'AnimusWebpackPlugin';

/**
 * Webpack adapter for the extraction pipeline. All pipeline logic lives in
 * the bundler-agnostic ExtractionSession — this class owns only the webpack
 * wiring: hook registration, cross-compiler analysis dedup, alias
 * harvesting from the compiler config, watch-event translation, and
 * in-memory CSS asset replacement.
 */
export class AnimusWebpackPlugin {
  private options: AnimusNextOptions;
  private session: ExtractionSession;
  private initialized = false;
  private aliasesExtracted = false;

  constructor(options: AnimusNextOptions) {
    this.options = options;
    // v2 is the only engine (openspec: retire-extract-v1). Reject a retired v1
    // selection loudly before publishing the shared choice — the option type no
    // longer admits 'v1', so cast to string to still catch a stale config or an
    // ANIMUS_ENGINE=v1 override at runtime.
    assertNoRetiredEngineSelection(options.engine as string | undefined);
    setSharedEngine(options.engine ?? 'v2');
    this.session = new ExtractionSession(options);
  }

  /** Extract path aliases from webpack's resolve.alias config. Runs once per
   *  plugin instance — the resolve config is immutable after apply. */
  private extractAliases(compiler: Compiler): void {
    if (this.aliasesExtracted) return;
    this.aliasesExtracted = true;
    const rootDir = compiler.context;
    const rawAlias = compiler.options?.resolve?.alias;
    if (!rawAlias || typeof rawAlias !== 'object') return;

    // Webpack alias is Record<string, string | string[] | false>
    const pairs: Array<{ pattern: string; target: string }> = [];
    for (const [key, value] of Object.entries(rawAlias)) {
      const target = Array.isArray(value) ? value[0] : value;
      if (typeof target !== 'string') continue;
      // Skip exactly the alias with-animus injected for the emitter's CSS
      // import — a consumer alias merely containing '.animus' must survive.
      if (key === ANIMUS_CSS_MODULE_ID) continue;
      pairs.push({ pattern: key, target });
    }

    const built = buildPathAliasesJson(pairs, rootDir);
    if (built) {
      this.session.pathAliasesJson = built.json;
    }
  }

  apply(compiler: Compiler): void {
    // Edge compiler has no CSS dependencies — skip entirely
    if (compiler.options?.name === 'edge-server') return;

    // processAssets: inject shared CSS into the .animus/styles.css asset in-memory.
    // This fires per-compilation for every compiler, ensuring all get correct CSS
    // regardless of which instance ran the extraction pipeline.
    compiler.hooks.compilation.tap(PLUGIN_NAME, (compilation: Compilation) => {
      const stage =
        compiler.webpack?.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL ?? -2000;
      const RawSource = compiler.webpack?.sources.RawSource;
      compilation.hooks.processAssets.tap({ name: PLUGIN_NAME, stage }, () => {
        const css = getSharedCss();
        if (!css || !RawSource) return;

        // Try absolute path first, then relative — asset name depends on
        // how webpack resolved the .animus/styles.css import
        const rootDir = this.session.rootDir || compiler.context;
        const cssPath = join(rootDir, '.animus', 'styles.css');
        if (compilation.getAsset(cssPath)) {
          compilation.updateAsset(cssPath, new RawSource(css));
          return;
        }
        if (compilation.getAsset(ANIMUS_CSS_MODULE_ID)) {
          compilation.updateAsset(ANIMUS_CSS_MODULE_ID, new RawSource(css));
        }
      });
    });

    // Production build: run once
    compiler.hooks.run.tapPromise(PLUGIN_NAME, async (_compiler: Compiler) => {
      this.session.rootDir = _compiler.context;
      this.extractAliases(_compiler);

      const existing = getAnalysisPromise();
      if (existing) {
        await existing;
        return;
      }

      const promise = this.session.runFullPipeline();
      setAnalysisPromise(promise);
      await promise;
    });

    // Dev watch: first run = full pipeline, subsequent = incremental
    compiler.hooks.watchRun.tapPromise(
      PLUGIN_NAME,
      async (_compiler: Compiler) => {
        this.session.rootDir = _compiler.context;
        this.extractAliases(_compiler);

        if (!this.initialized) {
          const existing = getAnalysisPromise();
          if (existing) {
            await existing;
            this.initialized = true;
            return;
          }

          const promise = this.session.runFullPipeline();
          setAnalysisPromise(promise);
          await promise;
          this.initialized = true;
          return;
        }

        // Incremental: detect changes and re-analyze if needed
        await this.session.handleWatchUpdate({
          modifiedFiles: _compiler.modifiedFiles,
          removedFiles: _compiler.removedFiles,
        });
      }
    );
  }

  /**
   * Reset analysis state for HMR geological reset.
   */
  resetForHmr(): void {
    this.session.resetForHmr();
  }

  /** Expose options for the loader */
  getOptions(): AnimusNextOptions {
    return this.options;
  }

  /** Expose external package directories for webpack loader allowlisting.
   *  Falls back to shared globalThis state for non-owning compiler instances. */
  getExternalPackageDirs(): string[] {
    return this.session.externalPackageDirs.length > 0
      ? this.session.externalPackageDirs
      : getSharedExternalDirs();
  }

  /** Expose external package source entries for webpack resolve alias.
   *  Falls back to shared globalThis state for non-owning compiler instances. */
  getExternalSourceEntries(): Map<string, string> {
    return this.session.externalSourceEntries.size > 0
      ? this.session.externalSourceEntries
      : getSharedExternalEntries();
  }
}
