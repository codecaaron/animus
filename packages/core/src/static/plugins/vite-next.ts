/**
 * Next-generation Vite plugin for Animus
 * Incorporates best practices from Tamagui and other mature plugins
 */

import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { build as esbuildBuild } from "esbuild";
import type { Plugin } from "vite";

import {
  generateLayeredCSSFromProject,
} from "../extractFromProject";
import { transformAnimusCode } from "../transformer";

// Types

export interface AnimusNextPluginOptions {
  theme?: string;
  output?: string;
  themeMode?: "inline" | "css-variable" | "hybrid";
  atomic?: boolean;
  transform?: boolean | TransformOptions; // Enable AST transformation with options
  transformExclude?: RegExp; // Files to exclude from transformation
}

export interface TransformOptions {
  enabled?: boolean;
  mode?: 'production' | 'development' | 'both'; // When to apply transformation
  preserveDevExperience?: boolean; // Keep runtime behavior in dev for better DX
  injectMetadata?: 'inline' | 'external' | 'both'; // How to inject metadata
  shimImportPath?: string; // Custom path for runtime shim
}

// Theme loading with esbuild
async function loadTheme(themePath: string): Promise<any> {
  const fullPath = resolve(process.cwd(), themePath);

  if (!existsSync(fullPath)) {
    throw new Error(`Theme file not found: ${themePath}`);
  }

  try {
    if (fullPath.endsWith(".ts") || fullPath.endsWith(".tsx")) {
      // Use esbuild for TypeScript themes
      const result = await esbuildBuild({
        entryPoints: [fullPath],
        bundle: false,
        write: false,
        format: "esm",
        platform: "node",
        target: "node16",
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
          const { unlink } = await import("node:fs/promises");
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
export function animusNext(options: AnimusNextPluginOptions = {}): Plugin {
  const {
    theme: themePath,
    output = "animus.css",
    themeMode = "hybrid",
    atomic = true,
    transform = true,
    transformExclude = /node_modules/,
  } = options;

  // Parse transform options
  const transformConfig: TransformOptions = typeof transform === 'object'
    ? transform
    : { enabled: transform };

  // Set defaults for transform config
  const {
    enabled: transformEnabled = true,
    mode: transformMode = 'production',
    preserveDevExperience = true,
    injectMetadata = 'inline',
    shimImportPath = '@animus-ui/core/runtime'
  } = transformConfig;

  let rootDir: string;
  let isDev: boolean;
  let theme: any;
  let extractedMetadata: Record<string, any> = {};

  return {
    name: "vite-plugin-animus-next",

    async config(_config, { command }) {
      isDev = command === "serve";

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
      const shouldTransform = transformEnabled && (
        (transformMode === 'both') ||
        (transformMode === 'production' && !isDev) ||
        (transformMode === 'development' && isDev)
      );

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
        });

        if (transformed) {
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
        this.info("Loading theme...");
        theme = await loadTheme(themePath);
      }

      // Pre-generate CSS to get component metadata for transformation
      if (transformEnabled && transformMode !== 'development') {
        this.info("Pre-extracting styles for transformation...");

        const styles = await generateLayeredCSSFromProject(rootDir, {
          theme,
          themeResolution: themeMode,
          atomic,
        });

        if (styles.componentMetadata) {
          extractedMetadata = styles.componentMetadata;
          this.info(`Found metadata for ${Object.keys(extractedMetadata).length} components`);
        }
      }

      this.info("Animus Next plugin initialized");
    },

    async generateBundle() {
      if (isDev) return;

      this.info("Extracting styles from project...");

      // Generate layered CSS using full extraction
      const styles = await generateLayeredCSSFromProject(rootDir, {
        theme,
        themeResolution: themeMode,
        atomic,
      });

      if (!styles.fullCSS) {
        this.warn("No Animus styles found in project");
        return;
      }

      // Emit CSS file
      this.emitFile({
        type: "asset",
        fileName: output,
        source: styles.fullCSS,
      });

      // Emit component metadata for runtime shims
      // Use the pre-extracted metadata which should match what was used in transformation
      const allMetadata = extractedMetadata;

      if (Object.keys(allMetadata).length > 0) {
        const metadataFileName = output.replace(/\.css$/, '.metadata.json');
        this.emitFile({
          type: "asset",
          fileName: metadataFileName,
          source: JSON.stringify(allMetadata, null, 2),
        });
        this.info(`Generated component metadata: ${metadataFileName}`);
      }

      this.info(`Generated ${(styles.fullCSS.length / 1024).toFixed(2)}KB of CSS`);
    },
  };
}

export default animusNext;
