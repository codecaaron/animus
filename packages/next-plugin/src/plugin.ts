import { createHash } from 'crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'fs';
import { dirname, extname, join, relative, resolve } from 'path';

import {
  applyPrefix,
  applyUnitFallback,
  assembleStylesheet,
  extractSystemFilePackages,
} from '@animus-ui/extract/pipeline';

import {
  getAnalysisPromise,
  resetAnalysisPromise,
  setAnalysisPromise,
  setManifestJson,
} from './singleton';
import type { AnimusNextOptions } from './types';

type Compiler = {
  hooks: {
    run: {
      tapPromise: (name: string, fn: (c: Compiler) => Promise<void>) => void;
    };
    watchRun: {
      tapPromise: (name: string, fn: (c: Compiler) => Promise<void>) => void;
    };
  };
  context: string;
};

const PLUGIN_NAME = 'AnimusWebpackPlugin';

export class AnimusWebpackPlugin {
  private options: AnimusNextOptions;
  private rootDir: string | null = null;

  // System config (loaded once via subprocess)
  private configJson = '';
  private groupRegistryJson = '';
  private themeJson = '';
  private variableMapJson = '';
  private variableCss = '';
  private contextualVarsJson: string | null = null;
  private globalCss = '';
  private globalStyleBlocksJson: string | null = null;

  // File tracking for HMR
  private fileCache = new Map<string, { hash: string; source: string }>();
  private lastCssHash: string | null = null;

  // Absolute directory prefixes for external DS packages (for loader allowlisting)
  private externalPackageDirs: string[] = [];

  // Map of external package specifier → absolute source entry path (for webpack resolve alias)
  private externalSourceEntries = new Map<string, string>();

  constructor(options: AnimusNextOptions) {
    this.options = options;
  }

  private get verbose(): boolean {
    return (
      this.options.verbose === true ||
      process.env.ANIMUS_DEBUG === '1' ||
      process.env.ANIMUS_DEBUG === 'true'
    );
  }

  private log(msg: string): void {
    if (this.verbose) {
      console.info(`[animus] ${msg}`);
    }
  }

  // Zero-cost timer gate
  private now(): number {
    return this.verbose ? performance.now() : 0;
  }
  private elapsed(t: number): number {
    return this.verbose ? Math.round(performance.now() - t) : 0;
  }

  private logBuildTimings(
    bt: Record<string, number>,
    rustTiming: Record<string, number> | undefined
  ): void {
    if (!this.verbose) return;
    const jsPhases: Array<[string, string]> = [
      ['systemLoad', 'system-load'],
      ['fileDiscovery', 'file-discovery'],
      ['fileRead', 'file-read+hash'],
      ['packageResolve', 'pkg-resolve'],
      ['analysis', 'analysis'],
    ];
    for (const [key, label] of jsPhases) {
      const ms = bt[key] ?? 0;
      if (ms === 0 && !bt.hasOwnProperty(key)) continue;
      const pad = ' '.repeat(Math.max(0, 17 - label.length));
      this.log(`  ${label}${pad}${String(ms).padStart(5)}ms`);

      if (key === 'analysis') {
        for (const [sk, sl] of [
          ['jsonSerialize', 'json-serialize'],
          ['rustExtract', 'rust-extract'],
          ['jsonParse', 'json-parse'],
        ] as const) {
          const sms = bt[sk] ?? 0;
          const spad = ' '.repeat(Math.max(0, 15 - sl.length));
          this.log(`    ${sl}${spad}${String(sms).padStart(5)}ms`);

          if (sk === 'rustExtract' && rustTiming) {
            const rustPhases: Array<[string, string]> = [
              ['parseAndWalk', 'parse+walk'],
              ['importResolution', 'imports'],
              ['extensionProvenance', 'provenance'],
              ['topologicalSort', 'topo-sort'],
              ['chainEvaluation', 'chains'],
              ['jsxScanning', 'jsx-scan'],
              ['systemPropAggregation', 'sys-props'],
              ['usageLedger', 'usage'],
              ['reconciliation', 'reconcile'],
              ['cssGeneration', 'css-gen'],
              ['manifestSerialization', 'serialize'],
            ];
            for (const [rk, rl] of rustPhases) {
              const rms = rustTiming[rk] ?? 0;
              const rpad = ' '.repeat(Math.max(0, 13 - rl.length));
              const rextra =
                rk === 'parseAndWalk'
                  ? `  (${rustTiming.fileCount ?? 0} files, ${rustTiming.cacheHits ?? 0} cached)`
                  : '';
              this.log(
                `      ${rl}${rpad}${String(rms).padStart(5)}ms${rextra}`
              );
            }
          }
        }
      }
    }
    this.log(`  total             ${String(bt.total).padStart(5)}ms`);

    if (process.env.ANIMUS_TIMING_JSON === '1') {
      const merged: Record<string, number> = {};
      for (const [k, v] of Object.entries(bt)) {
        merged[`buildStart.${k}`] = v;
      }
      if (rustTiming) {
        for (const [k, v] of Object.entries(rustTiming)) {
          if (typeof v === 'number') merged[`rust.${k}`] = v;
        }
      }
      console.info(`[animus:timing] ${JSON.stringify(merged)}`);
    }
  }

  private initialized = false;

  apply(compiler: Compiler): void {
    // Production build: run once
    compiler.hooks.run.tapPromise(PLUGIN_NAME, async (_compiler: Compiler) => {
      this.rootDir = _compiler.context;

      const existing = getAnalysisPromise();
      if (existing) {
        await existing;
        return;
      }

      const promise = this.runFullPipeline();
      setAnalysisPromise(promise);
      await promise;
    });

    // Dev watch: first run = full pipeline, subsequent = incremental
    compiler.hooks.watchRun.tapPromise(
      PLUGIN_NAME,
      async (_compiler: Compiler) => {
        this.rootDir = _compiler.context;

        if (!this.initialized) {
          const existing = getAnalysisPromise();
          if (existing) {
            await existing;
            this.initialized = true;
            return;
          }

          const promise = this.runFullPipeline();
          setAnalysisPromise(promise);
          await promise;
          this.initialized = true;
          return;
        }

        // Incremental: detect changes and re-analyze if needed
        await this.handleWatchUpdate();
      }
    );
  }

  private async handleWatchUpdate(): Promise<void> {
    const rootDir = this.rootDir!;
    const resolvedSystemPath = resolve(rootDir, this.options.system);

    // Check for geological reset: system file changed
    try {
      const systemSource = readFileSync(resolvedSystemPath, 'utf-8');
      const systemRelPath = relative(rootDir, resolvedSystemPath);
      const cached = this.fileCache.get(systemRelPath);
      const currentHash = createHash('md5').update(systemSource).digest('hex');

      if (cached && cached.hash !== currentHash) {
        // Geological reset: system file changed
        this.resetForHmr();
        this.initialized = false;
        const promise = this.runFullPipeline();
        setAnalysisPromise(promise);
        await promise;
        this.initialized = true;
        return;
      }
    } catch {}

    // Check for component file changes
    const excludePatterns = this.options.exclude ?? [
      'node_modules',
      'dist',
      '.test.',
      '.spec.',
      '.next',
      '.animus',
    ];
    const files = this.discoverFiles(rootDir, rootDir, excludePatterns);
    let hasChanges = false;

    for (const filePath of files) {
      const relPath = relative(rootDir, filePath);
      const cached = this.fileCache.get(relPath);
      const source = readFileSync(filePath, 'utf-8');
      const hash = createHash('md5').update(source).digest('hex');

      if (!cached || cached.hash !== hash) {
        hasChanges = true;
        this.fileCache.set(relPath, { hash, source });
      }
    }

    if (hasChanges) {
      // Re-run analysis with updated file entries
      resetAnalysisPromise();
      const promise = this.runFullPipeline();
      setAnalysisPromise(promise);
      await promise;
    }
  }

  private async runFullPipeline(): Promise<void> {
    const pipelineStart = this.now();
    const bt: Record<string, number> = {};

    // Clear Rust-side per-file cache so stale results from a prior
    // build never bleed into a fresh pipeline run.
    try {
      const { clearAnalysisCache } = require('@animus-ui/extract');
      clearAnalysisCache();
    } catch {
      // clearAnalysisCache may not exist in older builds
    }

    const rootDir = this.rootDir!;
    const resolvedSystemPath = resolve(rootDir, this.options.system);

    // Step 1: Load system via subprocess
    let t = this.now();
    this.loadSystem(rootDir, resolvedSystemPath);
    bt.systemLoad = this.elapsed(t);

    // Step 2: Discover source files
    t = this.now();
    const excludePatterns = this.options.exclude ?? [
      'node_modules',
      'dist',
      '.test.',
      '.spec.',
      '.next',
      '.animus',
    ];
    const files = this.discoverFiles(rootDir, rootDir, excludePatterns);

    bt.fileDiscovery = this.elapsed(t);

    // Step 3: Read file sources and build entries
    t = this.now();
    const fileEntries: Array<{ path: string; source: string; hash?: string }> =
      [];
    for (const filePath of files) {
      const source = readFileSync(filePath, 'utf-8');
      const relPath = relative(rootDir, filePath);
      const hash = createHash('md5').update(source).digest('hex');
      this.fileCache.set(relPath, { hash, source });
      fileEntries.push({ path: relPath, source, hash });
    }

    bt.fileRead = this.elapsed(t);
    bt.fileCount = fileEntries.length;

    // Step 4: Resolve external packages from system file imports
    t = this.now();
    const packageNames = extractSystemFilePackages(resolvedSystemPath);
    const packageMap = this.resolvePackagesByName(rootDir, packageNames);

    // Step 4b: Discover and read external package source files
    const excludePatternsForPkgs = ['dist', '.test.', '.spec.'];
    const collectedPkgDirs: string[] = [];
    this.externalSourceEntries.clear();

    for (const [specifier, entryRelPath] of Object.entries(packageMap)) {
      const absEntry = resolve(rootDir, entryRelPath);

      // Find the package root (directory containing package.json)
      let pkgRoot = dirname(absEntry);
      while (
        pkgRoot !== dirname(pkgRoot) &&
        !existsSync(join(pkgRoot, 'package.json'))
      ) {
        pkgRoot = dirname(pkgRoot);
      }

      // Discover source files from src/ (builder chains live in source, not dist)
      const srcDir = join(pkgRoot, 'src');
      if (existsSync(srcDir)) {
        collectedPkgDirs.push(srcDir);

        // Update packageMap to point to source entry for import resolution
        const srcEntry = join(srcDir, 'index.ts');
        if (existsSync(srcEntry)) {
          packageMap[specifier] = relative(rootDir, srcEntry);
          this.externalSourceEntries.set(specifier, srcEntry);
        }

        const pkgFiles = this.discoverFiles(
          srcDir,
          rootDir,
          excludePatternsForPkgs
        );
        for (const pkgFile of pkgFiles) {
          const pkgRelPath = relative(rootDir, pkgFile);
          if (!fileEntries.some((e) => e.path === pkgRelPath)) {
            try {
              const pkgSource = readFileSync(pkgFile, 'utf-8');
              const pkgHash = createHash('md5').update(pkgSource).digest('hex');
              this.fileCache.set(pkgRelPath, {
                hash: pkgHash,
                source: pkgSource,
              });
              fileEntries.push({
                path: pkgRelPath,
                source: pkgSource,
                hash: pkgHash,
              });
            } catch {}
          }
        }
      } else {
        // No src/ — fall back to resolved entry directory
        collectedPkgDirs.push(dirname(absEntry));
      }
    }

    this.externalPackageDirs = collectedPkgDirs;

    bt.packageResolve = this.elapsed(t);

    // Step 5: Run NAPI analysis
    const { analyzeProject } = require('@animus-ui/extract');
    const animusDirPath = join(rootDir, '.animus');
    const emitterConfig = JSON.stringify({
      runtime_import: '@animus-ui/system/runtime',
      css_module_id: '.animus/styles.css',
      system_props_module_id: join(animusDirPath, 'system-props.js'),
    });

    // Sub-phase: JSON serialize
    t = this.now();
    const fileEntriesJson = JSON.stringify(fileEntries);
    const packageMapJson = JSON.stringify(packageMap);
    bt.jsonSerialize = this.elapsed(t);

    // Sub-phase: NAPI call
    t = this.now();
    const manifestJson: string = analyzeProject(
      fileEntriesJson,
      this.themeJson,
      this.variableMapJson,
      this.contextualVarsJson || null,
      this.configJson,
      this.groupRegistryJson,
      packageMapJson,
      false, // prod mode
      emitterConfig,
      null, // selectorAliasesJson
      null, // selectorOrderJson
      this.globalStyleBlocksJson
    );
    bt.rustExtract = this.elapsed(t);

    // Sub-phase: JSON parse
    t = this.now();
    const manifest = JSON.parse(manifestJson);
    bt.jsonParse = this.elapsed(t);
    bt.analysis =
      (bt.jsonSerialize ?? 0) + (bt.rustExtract ?? 0) + (bt.jsonParse ?? 0);

    if (manifest?.report) {
      this.log(
        `Extracted ${manifest.report.components_extracted ?? '?'}/${manifest.report.components_total ?? '?'} components (${bt.analysis}ms)`
      );
    }

    // Populate globalCss from Rust-resolved sheets (replaces subprocess)
    this.globalCss = manifest?.sheets?.global || '';

    // CSS from Rust is fully resolved — transforms evaluated in-process via boa_engine.
    let componentCss: string = manifest?.css || '';

    // Step 7: Apply unit fallback
    componentCss = applyUnitFallback(componentCss);

    // Step 8: Assemble full stylesheet (canonical order via shared function)
    const fullCss = assembleStylesheet({
      layers: this.options.layers,
      variableCss: this.variableCss,
      globalCss: this.globalCss,
      componentCss,
    });

    // Step 9: Write to .animus/styles.css with content-hash dedup
    const cssHash = createHash('md5').update(fullCss).digest('hex');
    if (cssHash !== this.lastCssHash) {
      const animusDir = join(rootDir, '.animus');
      if (!existsSync(animusDir)) {
        mkdirSync(animusDir, { recursive: true });
      }
      writeFileSync(join(animusDir, 'styles.css'), fullCss);
      this.lastCssHash = cssHash;
    }

    // Step 10: Write system-props module for runtime resolution
    const systemPropMap = JSON.stringify(manifest?.system_prop_map ?? {});
    const dynamicProps = manifest?.dynamic_props ?? {};
    const dynamicPropConfig: Record<string, Record<string, unknown>> = {};
    for (const [propName, meta] of Object.entries(dynamicProps) as [
      string,
      Record<string, unknown>,
    ][]) {
      dynamicPropConfig[propName] = {
        varName: meta.var_name,
        slotClass: meta.slot_class,
        ...(meta.transform_name ? { transformName: meta.transform_name } : {}),
        ...(meta.scale_values &&
        Object.keys(meta.scale_values as Record<string, unknown>).length > 0
          ? { scaleValues: meta.scale_values }
          : {}),
      };
    }

    // Transforms are resolved at extraction time via boa_engine in Rust.
    // Runtime transform functions not yet supported for dynamic props.
    const transformsSource = '{}';

    const animusDir = join(rootDir, '.animus');
    if (!existsSync(animusDir)) {
      mkdirSync(animusDir, { recursive: true });
    }
    writeFileSync(
      join(animusDir, 'system-props.js'),
      `export const systemPropMap = ${systemPropMap};\n` +
        `export const systemPropGroups = ${this.groupRegistryJson};\n` +
        `export const dynamicPropConfig = ${JSON.stringify(dynamicPropConfig)};\n` +
        `export const transforms = ${transformsSource};\n`
    );

    // Store manifest for loader
    setManifestJson(manifestJson);

    bt.total = this.elapsed(pipelineStart);
    this.logBuildTimings(bt, manifest?.timing);
  }

  private loadSystem(rootDir: string, systemPath: string): void {
    const { loadSystemModule } = require('@animus-ui/extract');
    const config = loadSystemModule(systemPath, rootDir);

    this.configJson = config.propConfig;
    this.groupRegistryJson = config.groupRegistry;
    this.themeJson = config.scalesJson;
    this.variableMapJson = config.variableMapJson;
    this.variableCss = config.variableCss;
    this.contextualVarsJson = config.contextualVarsJson;

    if (this.options.prefix) {
      const prefixed = applyPrefix(
        this.options.prefix,
        this.variableMapJson,
        this.variableCss,
        this.themeJson,
        this.contextualVarsJson || undefined
      );
      this.variableMapJson = prefixed.variableMapJson;
      this.variableCss = prefixed.variableCss;
      if (prefixed.themeJson) this.themeJson = prefixed.themeJson;
      if (prefixed.contextualVarsJson)
        this.contextualVarsJson = prefixed.contextualVarsJson;
    }

    // Store raw global style blocks for Rust-side resolution in analyzeProject.
    this.globalStyleBlocksJson = config.globalStyleBlocks || null;
  }

  private discoverFiles(
    dir: string,
    rootDir: string,
    excludePatterns: string[]
  ): string[] {
    const results: string[] = [];
    const extensions = new Set(['.ts', '.tsx', '.js', '.jsx']);

    const walk = (currentDir: string) => {
      let entries: string[];
      try {
        entries = readdirSync(currentDir);
      } catch {
        return;
      }

      for (const entry of entries) {
        const fullPath = join(currentDir, entry);
        const relPath = relative(rootDir, fullPath);

        if (excludePatterns.some((p) => relPath.includes(p))) continue;

        let stat;
        try {
          stat = statSync(fullPath);
        } catch {
          continue;
        }

        if (stat.isDirectory()) {
          walk(fullPath);
        } else if (extensions.has(extname(entry))) {
          results.push(fullPath);
        }
      }
    };

    walk(dir);
    return results;
  }

  private resolvePackagesByName(
    rootDir: string,
    names: string[]
  ): Record<string, string> {
    if (names.length === 0) return {};

    const nameSet = new Set(names);
    const resolved = new Set<string>();
    const packageMap: Record<string, string> = {};

    // Pass 1: workspace resolution
    try {
      const rootPkg = JSON.parse(
        readFileSync(join(rootDir, 'package.json'), 'utf-8')
      );
      const workspaces: string[] = rootPkg.workspaces || [];

      for (const ws of workspaces) {
        const wsDir = resolve(rootDir, ws);
        if (!existsSync(wsDir)) continue;

        try {
          const pkg = JSON.parse(
            readFileSync(join(wsDir, 'package.json'), 'utf-8')
          );
          const name: string = pkg.name || '';

          if (nameSet.has(name)) {
            const main = pkg.main || pkg.module || 'index.ts';
            const entryPath = resolve(wsDir, main);
            if (existsSync(entryPath)) {
              packageMap[name] = relative(rootDir, entryPath);
              resolved.add(name);
            }
          }
        } catch {}
      }
    } catch {}

    // Pass 2: require.resolve fallback for non-workspace packages
    for (const name of nameSet) {
      if (resolved.has(name)) continue;
      try {
        const entryPath = require.resolve(name, { paths: [rootDir] });
        packageMap[name] = relative(rootDir, entryPath);
      } catch {}
    }

    return packageMap;
  }

  /**
   * Reset analysis state for HMR geological reset.
   */
  resetForHmr(): void {
    resetAnalysisPromise();
    this.lastCssHash = null;
    try {
      const { clearAnalysisCache } = require('@animus-ui/extract');
      clearAnalysisCache();
    } catch {}
  }

  /** Expose file cache for HMR change detection */
  getFileCache(): Map<string, { hash: string; source: string }> {
    return this.fileCache;
  }

  /** Expose options for the loader */
  getOptions(): AnimusNextOptions {
    return this.options;
  }

  /** Expose external package directories for webpack loader allowlisting */
  getExternalPackageDirs(): string[] {
    return this.externalPackageDirs;
  }

  /** Expose external package source entries for webpack resolve alias */
  getExternalSourceEntries(): Map<string, string> {
    return this.externalSourceEntries;
  }
}
