import { createHash } from 'crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { dirname, extname, join, relative, resolve } from 'path';

import {
  applyPrefix,
  applyUnitFallback,
  detectRuntime,
  execSubprocess,
  extractSystemFilePackages,
  resolveGlobalStyles,
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
  private systemResolveScript: string | null = null;

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
    const rootDir = this.rootDir!;
    const resolvedSystemPath = resolve(rootDir, this.options.system);

    // Step 1: Load system via subprocess
    this.loadSystem(rootDir, resolvedSystemPath);

    // Step 2: Discover source files
    const excludePatterns = this.options.exclude ?? [
      'node_modules',
      'dist',
      '.test.',
      '.spec.',
      '.next',
      '.animus',
    ];
    const files = this.discoverFiles(rootDir, rootDir, excludePatterns);

    // Step 3: Read file sources and build entries
    const fileEntries: Array<{ path: string; source: string; hash?: string }> =
      [];
    for (const filePath of files) {
      const source = readFileSync(filePath, 'utf-8');
      const relPath = relative(rootDir, filePath);
      const hash = createHash('md5').update(source).digest('hex');
      this.fileCache.set(relPath, { hash, source });
      fileEntries.push({ path: relPath, source, hash });
    }

    // Step 4: Resolve external packages from system file imports
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

        const pkgFiles = this.discoverFiles(srcDir, rootDir, excludePatternsForPkgs);
        for (const pkgFile of pkgFiles) {
          const pkgRelPath = relative(rootDir, pkgFile);
          if (!fileEntries.some((e) => e.path === pkgRelPath)) {
            try {
              const pkgSource = readFileSync(pkgFile, 'utf-8');
              const pkgHash = createHash('md5').update(pkgSource).digest('hex');
              this.fileCache.set(pkgRelPath, { hash: pkgHash, source: pkgSource });
              fileEntries.push({ path: pkgRelPath, source: pkgSource, hash: pkgHash });
            } catch {}
          }
        }
      } else {
        // No src/ — fall back to resolved entry directory
        collectedPkgDirs.push(dirname(absEntry));
      }
    }

    this.externalPackageDirs = collectedPkgDirs;

    // Step 5: Run NAPI analysis
    const { analyzeProject } = require('@animus-ui/extract');
    const animusDirPath = join(rootDir, '.animus');
    const emitterConfig = JSON.stringify({
      runtime_import: '@animus-ui/system/runtime',
      css_module_id: '.animus/styles.css',
      system_props_module_id: join(animusDirPath, 'system-props.js'),
    });
    const manifestJson: string = analyzeProject(
      JSON.stringify(fileEntries),
      this.themeJson,
      this.variableMapJson,
      this.contextualVarsJson || null,
      this.configJson,
      this.groupRegistryJson,
      JSON.stringify(packageMap),
      false, // prod mode
      this.options.prefix || null,
      emitterConfig
    );

    const manifest = JSON.parse(manifestJson);

    // Step 6: Resolve transform placeholders via subprocess
    let componentCss: string = manifest?.css || '';
    if (this.systemResolveScript && componentCss.includes('__TRANSFORM__')) {
      componentCss = this.resolveTransforms(rootDir, componentCss);
    }

    // Step 7: Apply unit fallback
    componentCss = applyUnitFallback(componentCss);

    // Step 8: Assemble full stylesheet
    const parts: string[] = [];
    if (this.variableCss) parts.push(this.variableCss);
    if (this.globalCss) parts.push(this.globalCss);
    if (componentCss) parts.push(componentCss);
    const fullCss = parts.join('\n\n');

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

    // Generate transforms source via subprocess if needed
    let transformsSource = '{}';
    if (this.systemResolveScript) {
      try {
        const resolvedSystemPath = resolve(rootDir, this.options.system);
        const tmpOut = join(tmpdir(), `animus-transforms-${Date.now()}.json`);
        const script =
          `const m = require(${JSON.stringify(resolvedSystemPath)});\n` +
          `const ds = m.ds || m.default || m.system;\n` +
          `const cfg = ds.toConfig();\n` +
          `const out = {};\n` +
          `for (const [name, fn] of Object.entries(cfg.transforms || {})) {\n` +
          `  out[name] = fn.toString();\n` +
          `}\n` +
          `require('fs').writeFileSync(${JSON.stringify(tmpOut)}, JSON.stringify(out));\n`;
        execSubprocess(script, rootDir);
        const fnStrings = JSON.parse(readFileSync(tmpOut, 'utf-8'));
        try {
          require('fs').unlinkSync(tmpOut);
        } catch {}
        const entries = Object.entries(fnStrings)
          .map(([name, src]) => `  ${JSON.stringify(name)}: ${src}`)
          .join(',\n');
        transformsSource = `{\n${entries}\n}`;
      } catch {}
    }

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
  }

  private loadSystem(rootDir: string, systemPath: string): void {
    const tmpOut = join(tmpdir(), `animus-system-${Date.now()}.json`);
    const script =
      `const m = require(${JSON.stringify(systemPath)});\n` +
      `const ds = m.ds || m.default || m.system;\n` +
      `if (!ds || !ds.toConfig) { throw new Error('Module does not export a SystemInstance with .serialize()'); }\n` +
      `const cfg = ds.toConfig();\n` +
      `const tokens = m.tokens || m.theme || null;\n` +
      `const serialized = tokens && typeof tokens.serialize === 'function' ? tokens.serialize() : null;\n` +
      `const globalStyleBlocks = {};\n` +
      `for (const [key, val] of Object.entries(m)) {\n` +
      `  if (val && typeof val === 'object' && val.__brand === 'GlobalStyleBlock') {\n` +
      `    globalStyleBlocks[key] = val.styles;\n` +
      `  }\n` +
      `}\n` +
      `require('fs').writeFileSync(${JSON.stringify(tmpOut)}, JSON.stringify({\n` +
      `  propConfig: cfg.propConfig,\n` +
      `  groupRegistry: cfg.groupRegistry,\n` +
      `  serialized: serialized,\n` +
      `  transformNames: Object.keys(cfg.transforms || {}),\n` +
      `  globalStyleBlocks: Object.keys(globalStyleBlocks).length > 0 ? globalStyleBlocks : null\n` +
      `}));\n`;

    execSubprocess(script, rootDir);
    const result = readFileSync(tmpOut, 'utf-8');
    try {
      require('fs').unlinkSync(tmpOut);
    } catch {}

    const parsed = JSON.parse(result);
    this.configJson = parsed.propConfig;
    this.groupRegistryJson = parsed.groupRegistry;

    if (parsed.serialized) {
      this.themeJson = parsed.serialized.scalesJson;
      this.variableMapJson = parsed.serialized.variableMapJson;
      this.variableCss = parsed.serialized.variableCss;
      this.contextualVarsJson = parsed.serialized.contextualVarsJson;

      if (this.options.prefix) {
        const prefixed = applyPrefix(
          this.options.prefix,
          this.variableMapJson,
          this.variableCss
        );
        this.variableMapJson = prefixed.variableMapJson;
        this.variableCss = prefixed.variableCss;
      }
    } else {
      throw new Error(
        '[animus-extract] Theme must be built with createTheme().build(). ' +
          'No .serialize() method found on tokens export.'
      );
    }

    // Resolve global styles
    if (parsed.globalStyleBlocks) {
      const hasBlocks = Object.keys(parsed.globalStyleBlocks).length > 0;
      if (hasBlocks) {
        try {
          const flat: Record<string, string> = JSON.parse(this.themeJson);
          const propConfig = JSON.parse(this.configJson);

          // Build variable map
          const variableMap: Record<string, string> = {};
          for (const [tokenPath, value] of Object.entries(flat)) {
            if (
              typeof value === 'string' &&
              value.startsWith('var(') &&
              value.endsWith(')')
            ) {
              variableMap[tokenPath] = value.slice(4, -1);
            }
          }

          // Global styles resolve in-process — transforms not available here,
          // so we use subprocess for systems that have transforms.
          const gsResult = resolveGlobalStyles(
            parsed.globalStyleBlocks,
            propConfig,
            flat,
            variableMap,
            {}
          );

          const parts = Object.values(gsResult).filter(Boolean);
          if (parts.length > 0) {
            this.globalCss = `@layer global {\n${(parts as string[]).join('\n\n')}\n}`;
          }
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          if (this.options.strict) {
            throw new Error(
              `[animus-extract] Global styles resolution failed: ${msg}`
            );
          }
          console.warn(
            '[animus-extract] Global styles resolution failed:',
            msg
          );
        }
      }
    }

    // Set up transform resolution script for later use
    if (parsed.transformNames && parsed.transformNames.length > 0) {
      const tmpResolve = join(
        tmpdir(),
        `animus-transforms-resolve-${Date.now()}.js`
      );
      writeFileSync(
        tmpResolve,
        `const m = require(${JSON.stringify(systemPath)});\n` +
          `const ds = m.ds || m.default || m.system;\n` +
          `const cfg = ds.toConfig();\n` +
          `const css = require('fs').readFileSync(process.argv[2], 'utf-8');\n` +
          `const resolved = css.replace(/__TRANSFORM__(\\w+)__(.+?)__/g, (_, name, rawValue) => {\n` +
          `  const fn = cfg.transforms[name];\n` +
          `  if (!fn) return rawValue;\n` +
          `  const value = rawValue !== '' && !isNaN(Number(rawValue)) ? Number(rawValue) : rawValue;\n` +
          `  const result = fn(value);\n` +
          `  return typeof result === 'object' ? JSON.stringify(result) : String(result);\n` +
          `});\n` +
          `require('fs').writeFileSync(process.argv[3], resolved);\n`
      );
      this.systemResolveScript = tmpResolve;
    }
  }

  private resolveTransforms(rootDir: string, css: string): string {
    const { execSync } = require('child_process');
    const ts = Date.now();
    const tmpIn = join(tmpdir(), `animus-css-${ts}.css`);
    const tmpOut = join(tmpdir(), `animus-css-${ts}.out.css`);
    writeFileSync(tmpIn, css);

    const runtime = detectRuntime();
    execSync(
      `${runtime} run "${this.systemResolveScript}" "${tmpIn}" "${tmpOut}"`,
      { cwd: rootDir, encoding: 'utf-8' }
    );

    const resolved = readFileSync(tmpOut, 'utf-8');
    try {
      require('fs').unlinkSync(tmpIn);
      require('fs').unlinkSync(tmpOut);
    } catch {}
    return resolved;
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
