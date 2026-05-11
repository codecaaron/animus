import {
  applyPrefix,
  applyUnitFallback,
  assembleStylesheet,
  DEFAULT_EXTENSIONS,
  extractSystemFilePackages,
  preprocessMdx,
} from '@animus-ui/extract/pipeline';
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
  getAnalysisPromise,
  getSharedCss,
  getSharedExternalDirs,
  getSharedExternalEntries,
  resetAnalysisPromise,
  setAnalysisPromise,
  setManifestJson,
  setSharedCss,
  setSharedExternalDirs,
  setSharedExternalEntries,
  setSharedSystemProps,
} from './singleton';

import type { AnimusNextOptions } from './types';

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

export class AnimusWebpackPlugin {
  private options: AnimusNextOptions;
  private rootDir: string | null = null;

  // System config (loaded once via NAPI)
  private configJson = '';
  private groupRegistryJson = '';
  private themeJson = '';
  private variableMapJson = '';
  private variableCss = '';
  private contextualVarsJson: string | null = null;
  private selectorAliasesJson: string | null = null;
  private selectorOrderJson: string | null = null;
  private globalCss = '';
  private globalStyleBlocksJson: string | null = null;
  private keyframesBlocksJson: string | null = null;
  private pathAliasesJson: string | null = null;

  // File tracking for HMR
  private fileCache = new Map<string, { hash: string; source: string }>();
  private lastCssHash: string | null = null;
  private lastSystemPropsHash: string | null = null;

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
    const jsPhases: [string, string][] = [
      ['systemLoad', 'system-load'],
      ['fileDiscovery', 'file-discovery'],
      ['fileRead', 'file-read+hash'],
      ['packageResolve', 'pkg-resolve'],
      ['analysis', 'analysis'],
    ];
    for (const [key, label] of jsPhases) {
      const ms = bt[key] ?? 0;
      if (ms === 0 && !Object.hasOwn(bt, key)) continue;
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
            const rustPhases: [string, string][] = [
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

  /** Extract path aliases from webpack's resolve.alias config. */
  private extractAliases(compiler: Compiler): void {
    const rootDir = compiler.context;
    const rawAlias = compiler.options?.resolve?.alias;
    if (!rawAlias || typeof rawAlias !== 'object') return;

    type AliasEntry = {
      pattern: string;
      replacement: string;
      type: 'prefix' | 'exact';
    };
    const entries: AliasEntry[] = [];

    // Webpack alias is Record<string, string | string[] | false>
    for (const [key, value] of Object.entries(rawAlias)) {
      const target = Array.isArray(value) ? value[0] : value;
      if (typeof target !== 'string') continue;
      // Skip our own .animus/styles.css alias
      if (key.includes('.animus')) continue;

      const replacement = target.startsWith(rootDir)
        ? target.slice(rootDir.length + 1)
        : target;
      const isExact = /\.\w+$/.test(replacement);
      if (isExact) {
        entries.push({ pattern: key, replacement, type: 'exact' });
      } else {
        entries.push({
          pattern: key.endsWith('/') ? key : key + '/',
          replacement: replacement.endsWith('/')
            ? replacement
            : replacement + '/',
          type: 'prefix',
        });
      }
    }

    entries.sort((a, b) => b.pattern.length - a.pattern.length);

    if (entries.length > 0) {
      this.pathAliasesJson = JSON.stringify({ aliases: entries });
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
        const rootDir = this.rootDir || compiler.context;
        const cssPath = join(rootDir, '.animus', 'styles.css');
        if (compilation.getAsset(cssPath)) {
          compilation.updateAsset(cssPath, new RawSource(css));
          return;
        }
        const relPath = '.animus/styles.css';
        if (compilation.getAsset(relPath)) {
          compilation.updateAsset(relPath, new RawSource(css));
        }
      });
    });

    // Production build: run once
    compiler.hooks.run.tapPromise(PLUGIN_NAME, async (_compiler: Compiler) => {
      this.rootDir = _compiler.context;
      this.extractAliases(_compiler);

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
        this.extractAliases(_compiler);

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
    // Guard: if system state was never loaded (non-owning instance that
    // skipped runFullPipeline), skip — processAssets reads from shared variable
    if (this.configJson === '') return;

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

    // Check for component file changes using content-hash diffing
    const excludePatterns = this.options.exclude ?? [
      'node_modules',
      'dist',
      '.test.',
      '.spec.',
      '.next',
      '.animus',
    ];
    const extensionsSet: ReadonlySet<string> = new Set(
      this.options.extensions ?? DEFAULT_EXTENSIONS
    );
    const shouldHandleMdx = extensionsSet.has('.mdx');
    const files = this.discoverFiles(
      rootDir,
      rootDir,
      excludePatterns,
      extensionsSet
    );
    const changedPaths: string[] = [];

    for (const filePath of files) {
      let relPath = relative(rootDir, filePath);
      let source = readFileSync(filePath, 'utf-8');

      if (shouldHandleMdx && extname(filePath) === '.mdx') {
        const result = await preprocessMdx(source, relPath);
        if (result.kind !== 'ok') {
          // Skip MDX files that can't preprocess (warning was emitted in full pipeline)
          continue;
        }
        source = result.source!;
        relPath = relPath + '.tsx';
      }

      const cached = this.fileCache.get(relPath);
      const hash = createHash('md5').update(source).digest('hex');

      if (!cached || cached.hash !== hash) {
        changedPaths.push(relPath);
        this.fileCache.set(relPath, { hash, source });
      }
    }

    if (changedPaths.length > 0) {
      // Build cache-aware file entries: full source only for changed files,
      // empty source + hash for unchanged (Rust cache-hit path skips these)
      const fileEntries = this.buildFileEntriesFromCache(changedPaths);

      resetAnalysisPromise();
      const promise = this.runIncrementalPipeline(fileEntries);
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

    // Step 1: Load system via NAPI
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
    const extensionsSet: ReadonlySet<string> = new Set(
      this.options.extensions ?? DEFAULT_EXTENSIONS
    );
    const shouldHandleMdx = extensionsSet.has('.mdx');
    let mdxMissingDepWarned = false;
    const files = this.discoverFiles(
      rootDir,
      rootDir,
      excludePatterns,
      extensionsSet
    );

    bt.fileDiscovery = this.elapsed(t);

    // Step 3: Read file sources and build entries (preprocessing MDX as we go)
    t = this.now();
    const fileEntries: Array<{ path: string; source: string; hash?: string }> =
      [];
    for (const filePath of files) {
      let source = readFileSync(filePath, 'utf-8');
      let relPath = relative(rootDir, filePath);

      if (shouldHandleMdx && extname(filePath) === '.mdx') {
        const result = await preprocessMdx(source, relPath);
        if (result.kind === 'missing-dep') {
          if (!mdxMissingDepWarned) {
            console.warn(
              '[animus] ⚠ .mdx in extensions but @mdx-js/mdx not installed; MDX files skipped'
            );
            mdxMissingDepWarned = true;
          }
          continue;
        }
        if (result.kind === 'error') {
          console.warn(
            `[animus] ⚠ MDX preprocessing failed for ${relPath}: ${result.error}`
          );
          continue;
        }
        source = result.source!;
        // Path rewrite so Rust source-type helper parses as tsx.
        relPath = relPath + '.tsx';
      }

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
          excludePatternsForPkgs,
          extensionsSet
        );
        for (const pkgFile of pkgFiles) {
          let pkgRelPath = relative(rootDir, pkgFile);
          if (!fileEntries.some((e) => e.path === pkgRelPath)) {
            try {
              let pkgSource = readFileSync(pkgFile, 'utf-8');

              if (shouldHandleMdx && extname(pkgFile) === '.mdx') {
                const result = await preprocessMdx(pkgSource, pkgRelPath);
                if (result.kind === 'missing-dep') {
                  if (!mdxMissingDepWarned) {
                    console.warn(
                      '[animus] ⚠ .mdx in extensions but @mdx-js/mdx not installed; MDX files skipped'
                    );
                    mdxMissingDepWarned = true;
                  }
                  continue;
                }
                if (result.kind === 'error') {
                  console.warn(
                    `[animus] ⚠ MDX preprocessing failed for ${pkgRelPath}: ${result.error}`
                  );
                  continue;
                }
                pkgSource = result.source!;
                pkgRelPath = pkgRelPath + '.tsx';
              }

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

    // Publish external package state for non-owning compiler instances
    setSharedExternalDirs(collectedPkgDirs);
    setSharedExternalEntries(this.externalSourceEntries);

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
      this.selectorAliasesJson,
      this.selectorOrderJson,
      this.globalStyleBlocksJson,
      this.pathAliasesJson,
      this.keyframesBlocksJson
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

    // Populate globalCss from Rust-resolved sheets
    this.globalCss = manifest?.sheets?.global || '';

    // CSS from Rust is fully resolved — transforms evaluated in-process via boa_engine.
    let componentCss: string = manifest?.css || '';

    // Step 7: Apply unit fallback
    componentCss = applyUnitFallback(componentCss);

    // Step 8: Assemble full stylesheet (canonical order via shared function)
    const { declaration, variables, body } = assembleStylesheet({
      layers: this.options.layers,
      variableCss: this.variableCss,
      globalCss: this.globalCss,
      componentCss,
      split: true,
    });
    const fullCss = [declaration, variables, body].filter(Boolean).join('\n');

    // Step 9: Store CSS in shared variable (authoritative source for processAssets)
    setSharedCss(fullCss);

    // Disk write serves as HMR trigger only — processAssets replaces content in-memory
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

    const systemPropsContent =
      `export const systemPropMap = ${systemPropMap};\n` +
      `export const systemPropGroups = ${this.groupRegistryJson};\n` +
      `export const dynamicPropConfig = ${JSON.stringify(dynamicPropConfig)};\n` +
      `export const transforms = ${transformsSource};\n`;

    setSharedSystemProps(systemPropsContent);
    writeFileSync(join(animusDir, 'system-props.js'), systemPropsContent);

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
    this.selectorAliasesJson = config.selectorAliases || null;
    this.selectorOrderJson = config.selectorOrder || null;

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
    this.keyframesBlocksJson = config.keyframesBlocks || null;
  }

  private discoverFiles(
    dir: string,
    rootDir: string,
    excludePatterns: string[],
    extensionsSet: ReadonlySet<string>
  ): string[] {
    const results: string[] = [];

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
        } else if (extensionsSet.has(extname(entry))) {
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
    this.lastSystemPropsHash = null;
    try {
      const { clearAnalysisCache } = require('@animus-ui/extract');
      clearAnalysisCache();
    } catch {}
  }

  /**
   * Build cache-aware file entries: full source for changed files,
   * empty source + hash for unchanged (Rust cache-hit path skips these).
   */
  private buildFileEntriesFromCache(
    changedPaths: string[]
  ): Array<{ path: string; source: string; hash: string }> {
    const changedSet = new Set(changedPaths);
    const entries: Array<{ path: string; source: string; hash: string }> = [];
    for (const [path, { hash, source }] of this.fileCache) {
      entries.push({
        path,
        source: changedSet.has(path) ? source : '',
        hash,
      });
    }
    return entries;
  }

  /**
   * Run incremental pipeline with cache-aware file entries.
   * Reuses system config from the last full pipeline run.
   */
  private async runIncrementalPipeline(
    fileEntries: Array<{ path: string; source: string; hash: string }>
  ): Promise<void> {
    const rootDir = this.rootDir!;
    const bt: Record<string, number> = {};
    const pipelineStart = this.now();

    const { analyzeProject } = require('@animus-ui/extract');
    const animusDirPath = join(rootDir, '.animus');
    const emitterConfig = JSON.stringify({
      runtime_import: '@animus-ui/system/runtime',
      css_module_id: '.animus/styles.css',
      system_props_module_id: join(animusDirPath, 'system-props.js'),
    });

    // Resolve packages from cache (already resolved during full pipeline)
    const packageMapJson = JSON.stringify(
      Object.fromEntries(
        Array.from(this.externalSourceEntries).map(([spec, entry]) => [
          spec,
          relative(rootDir, entry),
        ])
      )
    );

    let t = this.now();
    const fileEntriesJson = JSON.stringify(fileEntries);
    bt.jsonSerialize = this.elapsed(t);

    t = this.now();
    const manifestJson: string = analyzeProject(
      fileEntriesJson,
      this.themeJson,
      this.variableMapJson,
      this.contextualVarsJson || null,
      this.configJson,
      this.groupRegistryJson,
      packageMapJson,
      true, // dev mode: reuse cached JSX usage for unchanged files (empty source)
      emitterConfig,
      this.selectorAliasesJson,
      this.selectorOrderJson,
      this.globalStyleBlocksJson,
      this.pathAliasesJson,
      this.keyframesBlocksJson
    );
    bt.rustExtract = this.elapsed(t);

    t = this.now();
    const manifest = JSON.parse(manifestJson);
    bt.jsonParse = this.elapsed(t);

    // Populate globalCss from Rust-resolved sheets
    this.globalCss = manifest?.sheets?.global || '';

    let componentCss: string = manifest?.css || '';
    componentCss = applyUnitFallback(componentCss);

    const {
      declaration: hmrDecl,
      variables: hmrVars,
      body: hmrBody,
    } = assembleStylesheet({
      layers: this.options.layers,
      variableCss: this.variableCss,
      globalCss: this.globalCss,
      componentCss,
      split: true,
    });
    const fullCss = [hmrDecl, hmrVars, hmrBody].filter(Boolean).join('\n');

    // Store CSS in shared variable (authoritative source for processAssets)
    setSharedCss(fullCss);

    // Disk write serves as HMR trigger only
    const cssHash = createHash('md5').update(fullCss).digest('hex');
    if (cssHash !== this.lastCssHash) {
      const animusDir = join(rootDir, '.animus');
      if (!existsSync(animusDir)) {
        mkdirSync(animusDir, { recursive: true });
      }
      writeFileSync(join(animusDir, 'styles.css'), fullCss);
      this.lastCssHash = cssHash;
    }

    // Rebuild system-props module from updated manifest
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

    const systemPropsContent =
      `export const systemPropMap = ${systemPropMap};\n` +
      `export const systemPropGroups = ${this.groupRegistryJson};\n` +
      `export const dynamicPropConfig = ${JSON.stringify(dynamicPropConfig)};\n` +
      `export const transforms = {};\n`;

    setSharedSystemProps(systemPropsContent);

    const systemPropsHash = createHash('md5')
      .update(systemPropsContent)
      .digest('hex');
    if (systemPropsHash !== this.lastSystemPropsHash) {
      const spDir = join(rootDir, '.animus');
      if (!existsSync(spDir)) {
        mkdirSync(spDir, { recursive: true });
      }
      writeFileSync(join(spDir, 'system-props.js'), systemPropsContent);
      this.lastSystemPropsHash = systemPropsHash;
    }

    setManifestJson(manifestJson);

    bt.total = this.elapsed(pipelineStart);
    this.logBuildTimings(bt, manifest?.timing);
  }

  /** Expose file cache for HMR change detection */
  getFileCache(): Map<string, { hash: string; source: string }> {
    return this.fileCache;
  }

  /** Expose options for the loader */
  getOptions(): AnimusNextOptions {
    return this.options;
  }

  /** Expose external package directories for webpack loader allowlisting.
   *  Falls back to shared globalThis state for non-owning compiler instances. */
  getExternalPackageDirs(): string[] {
    return this.externalPackageDirs.length > 0
      ? this.externalPackageDirs
      : getSharedExternalDirs();
  }

  /** Expose external package source entries for webpack resolve alias.
   *  Falls back to shared globalThis state for non-owning compiler instances. */
  getExternalSourceEntries(): Map<string, string> {
    return this.externalSourceEntries.size > 0
      ? this.externalSourceEntries
      : getSharedExternalEntries();
  }
}
