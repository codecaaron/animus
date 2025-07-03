/**
 * Next-generation Vite plugin for Animus
 * Incorporates best practices from Tamagui and other mature plugins
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { build as esbuildBuild } from 'esbuild';
import type { Plugin } from 'vite';

import { getGroupDefinitionsForComponent } from '../cli/utils/groupDefinitions';
import { extractFromTypeScriptProject, generateLayeredCSSFromProject } from '../extractFromProject';
import type { ExtractedStyles } from '../extractor';
import { extractStylesFromCode } from '../extractor';
import { CSSGenerator, LayeredCSS } from '../generator';
import { TypeScriptStyleExtractor } from '../typescript-style-extractor';
import { TypeScriptUsageCollector } from '../typescript-usage-collector';
import type { ComponentUsage, UsageMap } from '../usageCollector';
import { buildUsageMap } from '../usageCollector';

// Types
interface CacheEntry {
  hash: string;
  mtime: number;
  styles: ExtractedStyles[];
  dependencies?: string[];
}

export interface AnimusNextPluginOptions {
  theme?: string;
  output?: string;
  themeMode?: 'inline' | 'css-variable' | 'hybrid';
  atomic?: boolean;
  useTypeScriptExtractor?: boolean;
  cacheDir?: string;
  include?: string[];
  exclude?: string[];
}

// Cache implementation
class ExtractionCache {
  private memoryCache = new Map<string, CacheEntry>();
  private cacheDir: string;
  private maxMemoryEntries = 1000;

  constructor(cacheDir: string) {
    this.cacheDir = cacheDir;
  }

  async initialize(): Promise<void> {
    await mkdir(this.cacheDir, { recursive: true });
  }

  async get(filePath: string, content: string): Promise<CacheEntry | null> {
    const contentHash = this.getContentHash(content);

    // Check memory cache
    const cached = this.memoryCache.get(filePath);
    if (cached && cached.hash === contentHash) {
      return cached;
    }

    // Check disk cache
    try {
      const cachePath = this.getCachePath(filePath);
      const data = await readFile(cachePath, 'utf-8');
      const diskCache = JSON.parse(data) as CacheEntry;

      if (diskCache.hash === contentHash) {
        this.updateMemoryCache(filePath, diskCache);
        return diskCache;
      }
    } catch {
      // Cache miss or invalid
    }

    return null;
  }

  async set(
    filePath: string,
    content: string,
    styles: ExtractedStyles[]
  ): Promise<void> {
    const entry: CacheEntry = {
      hash: this.getContentHash(content),
      mtime: Date.now(),
      styles,
    };

    // Update memory cache
    this.updateMemoryCache(filePath, entry);

    // Write to disk
    try {
      const cachePath = this.getCachePath(filePath);
      await mkdir(dirname(cachePath), { recursive: true });
      await writeFile(cachePath, JSON.stringify(entry, null, 2));
    } catch {
      // Ignore cache write errors
    }
  }

  private updateMemoryCache(filePath: string, entry: CacheEntry): void {
    // Implement simple LRU eviction
    if (this.memoryCache.size >= this.maxMemoryEntries) {
      const firstKey = this.memoryCache.keys().next().value;
      if (firstKey !== undefined) {
        this.memoryCache.delete(firstKey);
      }
    }
    this.memoryCache.set(filePath, entry);
  }

  private getContentHash(content: string): string {
    return createHash('sha256').update(content).digest('hex').slice(0, 16);
  }

  private getCachePath(filePath: string): string {
    const hash = createHash('sha256')
      .update(filePath)
      .digest('hex')
      .slice(0, 8);
    return resolve(this.cacheDir, `${hash}.json`);
  }
}

// Component registry for incremental building
class IncrementalRegistry {
  private components = new Map<string, ExtractedStyles[]>();
  private fileHashes = new Map<string, string>();
  private usages = new Map<string, ComponentUsage[]>();

  register(
    filePath: string,
    styles: ExtractedStyles[],
    contentHash: string
  ): void {
    this.components.set(filePath, styles);
    this.fileHashes.set(filePath, contentHash);
  }

  registerUsage(filePath: string, usages: ComponentUsage[]): void {
    this.usages.set(filePath, usages);
  }

  getAllComponents(): ExtractedStyles[] {
    return Array.from(this.components.values()).flat();
  }

  getAllUsages(): ComponentUsage[] {
    return Array.from(this.usages.values()).flat();
  }

  getUsageMap(): UsageMap {
    const allUsages = this.getAllUsages();
    return buildUsageMap(allUsages);
  }

  clear(): void {
    this.components.clear();
    this.fileHashes.clear();
    this.usages.clear();
  }
}

// Theme loading with esbuild
async function loadTheme(themePath: string): Promise<any> {
  const fullPath = resolve(process.cwd(), themePath);

  if (!existsSync(fullPath)) {
    throw new Error(`Theme file not found: ${themePath}`);
  }

  try {
    if (fullPath.endsWith('.ts') || fullPath.endsWith('.tsx')) {
      // Use esbuild for TypeScript themes
      const result = await esbuildBuild({
        entryPoints: [fullPath],
        bundle: false,
        write: false,
        format: 'esm',
        platform: 'node',
        target: 'node16',
      });

      // Create temporary file for import
      const tempPath = resolve(
        dirname(fullPath),
        `.animus-theme-${Date.now()}.mjs`
      );
      await writeFile(tempPath, result.outputFiles[0].text);

      try {
        const module = await import(tempPath);
        return module.default || module.theme || module;
      } finally {
        // Clean up temp file
        try {
          const { unlink } = await import('node:fs/promises');
          await unlink(tempPath);
        } catch {
          // Ignore cleanup errors
        }
      }
    } else {
      // Direct import for JS themes
      const module = await import(fullPath);
      return module.default || module.theme || module;
    }
  } catch (error) {
    throw new Error(
      `Failed to load theme: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// Helper to check if file should be processed
function shouldProcess(id: string, options: AnimusNextPluginOptions): boolean {
  // Skip non-JS/TS files
  if (!/\.(js|jsx|ts|tsx)$/.test(id)) return false;

  // Default excludes
  const excludes = options.exclude || ['node_modules', 'dist', '.git'];
  if (excludes.some((pattern) => id.includes(pattern))) return false;

  // Check includes if specified
  if (options.include && options.include.length > 0) {
    return options.include.some((pattern) => id.includes(pattern));
  }

  return true;
}

// Main plugin export
export function animusNext(options: AnimusNextPluginOptions = {}): Plugin {
  const {
    theme: themePath,
    output = 'animus.css',
    themeMode = 'hybrid',
    atomic = true,
    cacheDir = 'node_modules/.cache/animus',
  } = options;

  let rootDir: string;
  let isDev: boolean;
  let theme: any;
  let cache: ExtractionCache;
  let registry: IncrementalRegistry;
  let tsExtractor: TypeScriptStyleExtractor | null = null;
  let tsUsageCollector: TypeScriptUsageCollector | null = null;
  let styles: LayeredCSS;

  return {
    name: 'vite-plugin-animus-next',

    async config(_config, { command }) {
      isDev = command === 'serve';

      if (isDev) {
        // Skip in dev mode - runtime handles everything
        return;
      }

      return {
        css: {
          postcss: {
            plugins: [],
          },
        },
      };
    },

    async buildStart() {
      if (isDev) return;
      rootDir = process.cwd();

      // Initialize cache and registry
      cache = new ExtractionCache(resolve(rootDir, cacheDir));
      await cache.initialize();
      registry = new IncrementalRegistry();

      // Load theme if provided
      if (themePath) {
        this.info('Loading theme...');
        theme = await loadTheme(themePath);
      }


    styles = await generateLayeredCSSFromProject(rootDir, { theme, themeResolution: 'hybrid', atomic: true  });
      // Initialize TypeScript extractor if requested
      if (options.useTypeScriptExtractor) {
        tsExtractor = new TypeScriptStyleExtractor();
        tsUsageCollector = new TypeScriptUsageCollector();
        this.info('Using TypeScript extractor');
      } else {
        // Still use TypeScript for usage collection even with Babel extraction
        tsUsageCollector = new TypeScriptUsageCollector();
      }

      this.info('Animus Next plugin initialized');
    },

    async transform(code: string, id: string) {
      if (isDev || !shouldProcess(id, options)) return null;

      // Quick check for Animus usage
      // if (!code.includes('animus') && !code.includes('@animus-ui/core')) {
      //   return null;
      // }

      try {
        // Try cache first
        let styles = await cache.get(id, code);

        if (!styles) {
          // Extract styles using appropriate extractor
          const extractedStyles = tsExtractor
            ? tsExtractor.extractFromCode(code, id)
            : extractStylesFromCode(code);

          if (extractedStyles.length > 0) {
            // Cache the result
            await cache.set(id, code, extractedStyles);
            styles = {
              hash: '',
              mtime: Date.now(),
              styles: extractedStyles,
            };
          } else {
            return null;
          }
        }

        // Register components
        registry.register(id, styles.styles, styles.hash);

        // Collect usage data
        if (tsUsageCollector) {
          const usages = tsUsageCollector.extractUsage(code, id);
          if (usages.length > 0) {
            registry.registerUsage(id, usages);
          }
        }

        const componentNames = styles.styles
          .map((s) => s.componentName)
          .filter(Boolean)
          .join(', ');

        this.info(
          `Processed ${relative(rootDir, id)}: ${componentNames || 'anonymous'}`
        );
      } catch (error) {
        this.warn(
          `Failed to process ${id}: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      return null;
    },

    async generateBundle() {
      if (isDev) return;

      const components = registry.getAllComponents();

      if (components.length === 0) {
        this.warn('No Animus components found');
        return;
      }

      this.info(`Generating CSS for ${components.length} components...`);

      // Generate CSS
      const generator = new CSSGenerator({
        atomic,
        themeResolution: { mode: themeMode },
      });

      // Collect groups
      const allGroups = new Set<string>();
      for (const component of components) {
        if (component.groups) {
          component.groups.forEach((group) => allGroups.add(group));
        }
      }

      const groupDefinitions =
        allGroups.size > 0
          ? getGroupDefinitionsForComponent(Array.from(allGroups))
          : {};

      // Get usage map for atomic utilities
      const usageMap = registry.getUsageMap();

      // Log usage map for debugging
      if (Object.keys(usageMap).length > 0) {
        this.info(
          `Collected usage for components: ${Object.keys(usageMap).join(', ')}`
        );
        for (const [comp, props] of Object.entries(usageMap)) {
          for (const [prop, values] of Object.entries(props)) {
            this.info(`  ${comp}.${prop}: ${Array.from(values).join(', ')}`);
          }
        }
      } else {
        this.info('No usage data collected');
      }

      // Generate CSS
      const cssChunks: string[] = [];
      for (const component of components) {
        const generated = generator.generateFromExtracted(
          component,
          groupDefinitions,
          theme,
          usageMap
        );

        if (generated.css) {
          cssChunks.push(generated.css);
        }
      }

      const css = cssChunks.join('\n\n');

      // Emit CSS file
      this.emitFile({
        type: 'asset',
        fileName: output,
        source: styles.fullCSS,
      });

      this.info(`Generated ${(css.length / 1024).toFixed(2)}KB of CSS`);
    },
  };
}

// Helper to resolve paths relative to the current module
function relative(from: string, to: string): string {
  const path = to.replace(from + '/', '');
  return path.length < to.length ? path : to;
}

export default animusNext;
