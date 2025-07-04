/**
 * Vite plugin for Animus static CSS extraction
 */

import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  CSSGenerator,
  ExtractedComponentGraph,
  GraphCache,
  generateLayeredCSSFromProject,
  ReferenceTraverser,
  transformAnimusCode,
  UsageTracker,
} from '@animus-ui/core/static';
import { build as esbuildBuild } from 'esbuild';
import type { Plugin } from 'vite';

import type { AnimusVitePluginOptions, TransformOptions } from './types';

// Default group definitions for CSS generation
const defaultGroupDefinitions = {
  space: {
    m: { property: 'margin', scale: 'space' },
    mt: { property: 'marginTop', scale: 'space' },
    mr: { property: 'marginRight', scale: 'space' },
    mb: { property: 'marginBottom', scale: 'space' },
    ml: { property: 'marginLeft', scale: 'space' },
    mx: { properties: ['marginLeft', 'marginRight'], scale: 'space' },
    my: { properties: ['marginTop', 'marginBottom'], scale: 'space' },
    p: { property: 'padding', scale: 'space' },
    pt: { property: 'paddingTop', scale: 'space' },
    pr: { property: 'paddingRight', scale: 'space' },
    pb: { property: 'paddingBottom', scale: 'space' },
    pl: { property: 'paddingLeft', scale: 'space' },
    px: { properties: ['paddingLeft', 'paddingRight'], scale: 'space' },
    py: { properties: ['paddingTop', 'paddingBottom'], scale: 'space' },
    gap: { property: 'gap', scale: 'space' },
  },
  color: {
    color: { property: 'color', scale: 'colors' },
    bg: { property: 'backgroundColor', scale: 'colors' },
    borderColor: { property: 'borderColor', scale: 'colors' },
    fill: { property: 'fill', scale: 'colors' },
    stroke: { property: 'stroke', scale: 'colors' },
  },
  background: {
    bg: { property: 'backgroundColor', scale: 'colors' },
  },
  typography: {
    fontSize: { property: 'fontSize', scale: 'fontSizes' },
    fontWeight: { property: 'fontWeight', scale: 'fontWeights' },
    lineHeight: { property: 'lineHeight', scale: 'lineHeights' },
    letterSpacing: { property: 'letterSpacing', scale: 'letterSpacings' },
    fontFamily: { property: 'fontFamily', scale: 'fonts' },
  },
  layout: {
    w: { property: 'width', scale: 'sizes' },
    h: { property: 'height', scale: 'sizes' },
    minW: { property: 'minWidth', scale: 'sizes' },
    maxW: { property: 'maxWidth', scale: 'sizes' },
    minH: { property: 'minHeight', scale: 'sizes' },
    maxH: { property: 'maxHeight', scale: 'sizes' },
    display: { property: 'display' },
    position: { property: 'position' },
  },
};

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
      `Failed to load theme: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

// Main plugin export
export function animusVitePlugin(
  options: AnimusVitePluginOptions = {}
): Plugin {
  const {
    theme: themePath,
    output = 'animus.css',
    themeMode = 'hybrid',
    atomic = true,
    transform = true,
    transformExclude = /node_modules/,
  } = options;

  // Parse transform options
  const transformConfig: TransformOptions =
    typeof transform === 'object' ? transform : { enabled: transform };

  // Set defaults for transform config
  const {
    enabled: transformEnabled = true,
    mode: transformMode = 'production',
    preserveDevExperience = true,
    injectMetadata = 'inline',
    shimImportPath = '@animus-ui/core/runtime',
  } = transformConfig;

  let rootDir: string;
  let isDev: boolean;
  let theme: any;
  let extractedMetadata: Record<string, any> = {};
  let componentGraph: ExtractedComponentGraph | null = null;
  let usageTracker: UsageTracker = new UsageTracker();
  let graphCache: GraphCache | null = null;

  return {
    name: 'vite-plugin-animus',

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

    async transform(code: string, id: string) {
      // Check if transformation should run based on mode
      const shouldTransform =
        transformEnabled &&
        (transformMode === 'both' ||
          (transformMode === 'production' && !isDev) ||
          (transformMode === 'development' && isDev));

      if (!shouldTransform) return null;

      // Skip files that should be excluded
      if (transformExclude && transformExclude.test(id)) return null;

      // Only transform TypeScript/JavaScript files
      if (!/\.(tsx?|jsx?|mjs)$/.test(id)) return null;

      // Skip if the file doesn't contain animus imports
      if (!code.includes('animus')) return null;

      try {
        const transformed = await transformAnimusCode(code, id, {
          componentMetadata: extractedMetadata,
          rootDir: rootDir || process.cwd(),
          generateMetadata: false, // Use pre-extracted metadata
          shimImportPath,
          injectMetadata,
          preserveDevExperience: preserveDevExperience && isDev,
          componentGraph: componentGraph || undefined, // Pass component graph for usage tracking
          usageTracker, // Pass usage tracker to record usage during transformation
        });

        if (transformed) {
          // Mark file as processed for usage tracking
          usageTracker.markFileProcessed();

          return {
            code: transformed.code,
            map: transformed.map,
          };
        }
      } catch (error) {
        this.warn(`Failed to transform ${id}: ${error}`);
      }

      return null;
    },

    async buildStart() {
      if (isDev) return;
      rootDir = process.cwd();

      // Load theme if provided
      if (themePath) {
        this.info('Loading theme...');
        theme = await loadTheme(themePath);
      }

      // Phase 1: Extract complete component graph
      // Always extract graph - needed for both transformation and CSS generation
      try {
        this.info('Extracting complete component graph...');

        // Initialize graph cache
        graphCache = new GraphCache(rootDir);

        // Try to load cached graph
        const cachedGraph = graphCache.load();

        if (cachedGraph) {
          componentGraph = cachedGraph;
          this.info(
            `Loaded cached graph with ${cachedGraph.metadata.totalComponents} components`
          );
        } else {
          // Extract fresh graph - it will create its own TypeScript program
          const { TypeScriptExtractor } = await import(
            '@animus-ui/core/static'
          );
          const extractor = new TypeScriptExtractor();
          extractor.initializeProgram(rootDir);

          // Create a temporary traverser just to call extractCompleteGraph
          // This is a workaround since we can't access the program directly
          const tempProgram = (extractor as any).program;
          if (!tempProgram) {
            throw new Error('Failed to initialize TypeScript program');
          }
          const traverser = new ReferenceTraverser(tempProgram);
          componentGraph = await traverser.extractCompleteGraph(rootDir);

          // Cache for future builds
          graphCache.save(componentGraph);

          this.info(
            `Extracted graph with ${componentGraph.metadata.totalComponents} components`
          );
        }

        // Extract metadata from graph for transformation
        extractedMetadata = {};
        for (const [, node] of componentGraph.components) {
          extractedMetadata[node.identity.name] = node.metadata;
        }
      } catch (error) {
        // Fall back to old method if graph extraction fails
        this.warn(
          `Graph extraction failed: ${error}, falling back to legacy extraction`
        );

        this.info('Pre-extracting styles for transformation...');

        const styles = await generateLayeredCSSFromProject(rootDir, {
          theme,
          themeResolution: themeMode as any,
          atomic,
        });

        if (styles.componentMetadata) {
          extractedMetadata = styles.componentMetadata;
          this.info(
            `Found metadata for ${Object.keys(extractedMetadata).length} components`
          );
        }
      }

      this.info('Animus plugin initialized');
    },

    async generateBundle() {
      if (isDev) return;

      this.info('Generating optimized CSS from usage data...');

      // Phase 2: Generate CSS using graph and actual usage data
      if (componentGraph) {
        // Use the actual usage data collected during transformation
        const usageSet = usageTracker.build();

        // Check if we have real usage data from JSX tracking
        const hasRealUsage = usageSet.components.size > 0;

        if (!hasRealUsage) {
          this.warn(
            'No usage data collected during transformation - using full extraction'
          );
        } else {
          this.info(
            `Collected real usage data for ${usageSet.components.size} components`
          );
        }

        // Count total props across all components
        let totalProps = 0;
        for (const [, usage] of usageSet.components) {
          totalProps += usage.props.size;
        }
        this.info(
          `Usage data: ${usageSet.components.size} components, ${totalProps} props used`
        );

        // Debug: log what's in the usage set
        for (const [_, usage] of usageSet.components) {
          this.info(
            `  Component ${usage.identity.name}: used=${usage.used}, variants=${usage.variants.size}, states=${usage.states.size}, props=${usage.props.size}`
          );
        }

        // Create CSS generator
        const generator = new CSSGenerator({
          atomic,
          themeResolution: themeMode as any,
        });

        // Generate CSS only for used components/variants/states
        const result = generator.generateFromGraphAndUsage(
          componentGraph,
          usageSet,
          defaultGroupDefinitions,
          theme
        );

        if (!result.fullCSS) {
          this.warn('No Animus styles found in project');
          return;
        }

        // Emit CSS file
        this.emitFile({
          type: 'asset',
          fileName: output,
          source: result.fullCSS,
        });

        // Emit complete metadata from graph (not just used)
        if (Object.keys(extractedMetadata).length > 0) {
          const metadataFileName = output.replace(/\.css$/, '.metadata.json');
          this.emitFile({
            type: 'asset',
            fileName: metadataFileName,
            source: JSON.stringify(extractedMetadata, null, 2),
          });
          this.info(`Generated component metadata: ${metadataFileName}`);
        }

        // Report optimization stats
        const totalComponents = componentGraph.metadata.totalComponents;
        const usedComponents = usageSet.components.size;
        const cssSize = (result.fullCSS.length / 1024).toFixed(2);

        this.info(`Generated ${cssSize}KB of CSS`);
        this.info(
          `Optimized: ${usedComponents}/${totalComponents} components used`
        );
      } else {
        // Fallback to old method if graph extraction failed
        this.warn(
          'Component graph not available, falling back to full extraction'
        );

        const styles = await generateLayeredCSSFromProject(rootDir, {
          theme,
          themeResolution: themeMode as any,
          atomic,
        });

        if (!styles.fullCSS) {
          this.warn('No Animus styles found in project');
          return;
        }

        this.emitFile({
          type: 'asset',
          fileName: output,
          source: styles.fullCSS,
        });

        this.info(
          `Generated ${(styles.fullCSS.length / 1024).toFixed(2)}KB of CSS (unoptimized)`
        );
      }
    },
  };
}
