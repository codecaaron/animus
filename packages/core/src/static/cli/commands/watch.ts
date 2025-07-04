/** biome-ignore-all lint/suspicious/noConsole: <Its a CLI Stupid> */

import { existsSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { dirname, resolve } from 'path';

import chalk from 'chalk';
import chokidar from 'chokidar';
import { Command } from 'commander';
import debounce from 'lodash/debounce';
import ora from 'ora';

import { extractFromTypeScriptProject } from '../..';
import { CSSGenerator } from '../../generator';
import { buildUsageMap } from '../../usageCollector';
import { getGroupDefinitionsForComponent } from '../utils/groupDefinitions';
import { transformThemeFile } from '../utils/themeTransformer';

interface WatchOptions {
  output?: string;
  theme?: string;
  atomic?: boolean;
  verbose?: boolean;
  themeMode?: 'inline' | 'css-variable' | 'hybrid';
}

export const watchCommand = new Command('watch')
  .description('Watch for changes and regenerate CSS')
  .argument('<input>', 'Input directory to watch')
  .option('-o, --output <path>', 'Output CSS file path')
  .option('-t, --theme <path>', 'Path to theme file')
  .option('--theme-mode <mode>', 'Theme resolution mode', 'hybrid')
  .option('--no-atomic', 'Disable atomic CSS generation')
  .option('-v, --verbose', 'Verbose output')
  .action(async (input: string, options: WatchOptions) => {
    const inputPath = resolve(process.cwd(), input);

    if (!existsSync(inputPath)) {
      console.error(chalk.red(`Input path does not exist: ${inputPath}`));
      process.exit(1);
    }

    console.log(chalk.cyan(`Watching for changes in ${inputPath}...`));

    // Load theme once at startup
    let theme = undefined;
    let transformedThemePath: string | undefined;

    if (options.theme) {
      const themePath = resolve(process.cwd(), options.theme);
      if (!existsSync(themePath)) {
        console.error(chalk.red(`Theme file does not exist: ${themePath}`));
        process.exit(1);
      }

      try {
        // Check if it's a TypeScript file
        if (themePath.endsWith('.ts') || themePath.endsWith('.tsx')) {
          transformedThemePath = transformThemeFile(themePath);
          const themeModule = await import(transformedThemePath);
          theme = themeModule.default || themeModule.theme || themeModule;
        } else {
          const themeModule = await import(themePath);
          theme = themeModule.default || themeModule.theme || themeModule;
        }
      } catch (error) {
        console.error(chalk.red('Failed to load theme:'), error);
        process.exit(1);
      }
    }

    // Create CSS generator
    const generator = new CSSGenerator({
      atomic: options.atomic !== false,
      themeResolution: { mode: options.themeMode || 'hybrid' },
    });

    // Track component data for incremental updates
    const componentCache = new Map<
      string,
      {
        css: string;
        extraction: any;
        lastModified: number;
      }
    >();

    // Map file paths to component hashes
    const fileToComponents = new Map<string, Set<string>>();

    // Extraction function
    const extractAndGenerate = async (changedFile?: string) => {
      const startTime = Date.now();
      const spinner = ora('Extracting components...').start();

      try {
        let results;
        let incrementalMode = false;

        // If a specific file changed and we have cache, try incremental update
        if (changedFile && componentCache.size > 0) {
          incrementalMode = true;
          spinner.text = `Extracting from ${changedFile}...`;

          // Extract just from the changed file
          const { results: fileResults } =
            await extractFromTypeScriptProject(changedFile);

          // Get old components from this file
          const oldComponents = fileToComponents.get(changedFile) || new Set();

          // Remove old components from cache
          oldComponents.forEach((hash) => componentCache.delete(hash));

          // Clear file mapping
          fileToComponents.set(changedFile, new Set());

          // Add new components to cache
          for (const result of fileResults) {
            const hash = result.extraction.componentName || 'unknown';
            componentCache.set(hash, {
              css: '', // Will be generated
              extraction: result.extraction,
              lastModified: Date.now(),
            });

            // Update file mapping
            const components = fileToComponents.get(changedFile) || new Set();
            components.add(hash);
            fileToComponents.set(changedFile, components);
          }

          // Reconstruct results from cache
          results = Array.from(componentCache.values()).map((cached) => ({
            extraction: cached.extraction,
            filePath: changedFile,
            usages: [], // TODO: preserve usages
          }));
        } else {
          // Full extraction
          const extracted = await extractFromTypeScriptProject(inputPath);
          results = extracted.results;

          // Rebuild cache
          componentCache.clear();
          fileToComponents.clear();

          for (const result of results) {
            const hash = result.extraction.componentName || 'unknown';
            componentCache.set(hash, {
              css: '', // Will be generated
              extraction: result.extraction,
              lastModified: Date.now(),
            });

            // Update file mapping
            const components =
              fileToComponents.get(result.filePath) || new Set();
            components.add(hash);
            fileToComponents.set(result.filePath, components);
          }
        }

        if (results.length === 0) {
          spinner.warn('No Animus components found');
          return;
        }

        spinner.text = incrementalMode
          ? `Regenerating CSS for ${changedFile}...`
          : 'Generating CSS...';

        // Build usage map
        const allUsages = results.flatMap((r) => r.usages || []);
        const usageMap = buildUsageMap(allUsages);

        // Generate CSS
        const cssChunks: string[] = [];
        const cssVariables = new Map<string, string>();
        const usedTokens = new Set<string>();

        for (const result of results) {
          const { extraction } = result;
          // Get group definitions based on enabled groups
          const groupDefinitions = extraction.groups
            ? getGroupDefinitionsForComponent(extraction.groups)
            : {};

          const generated = generator.generateFromExtracted(
            extraction,
            groupDefinitions,
            theme,
            usageMap
          );

          cssChunks.push(generated.css);

          // Collect CSS variables
          if (generated.cssVariables) {
            const matches = generated.cssVariables.matchAll(
              /\s*(--[^:]+):\s*([^;]+);/g
            );
            for (const match of matches) {
              cssVariables.set(match[1], match[2]);
            }
          }

          // Collect used tokens
          if (generated.usedTokens) {
            generated.usedTokens.forEach((token) => usedTokens.add(token));
          }
        }

        // Build final CSS
        let finalCSS = '';

        if (cssVariables.size > 0) {
          const varDeclarations = Array.from(cssVariables.entries())
            .map(([varName, value]) => `  ${varName}: ${value};`)
            .join('\n');
          finalCSS = `:root {\n${varDeclarations}\n}\n\n`;
        }

        finalCSS += cssChunks.join('\n\n');

        // Output results
        if (options.output) {
          const outputPath = resolve(process.cwd(), options.output);
          await mkdir(dirname(outputPath), { recursive: true });
          await writeFile(outputPath, finalCSS, 'utf-8');
        } else {
          console.log('\n' + finalCSS);
        }

        const elapsed = Date.now() - startTime;
        spinner.succeed(
          `Generated CSS for ${results.length} components in ${elapsed}ms`
        );

        if (options.verbose) {
          console.log(
            chalk.gray(`  CSS size: ${(finalCSS.length / 1024).toFixed(2)}KB`)
          );
          console.log(chalk.gray(`  CSS variables: ${cssVariables.size}`));
          console.log(chalk.gray(`  Used tokens: ${usedTokens.size}`));
        }
      } catch (error) {
        spinner.fail('Extraction failed');
        console.error(
          chalk.red(error instanceof Error ? error.message : String(error))
        );
        if (options.verbose && error instanceof Error) {
          console.error(chalk.gray(error.stack));
        }
      }
    };

    // Initial extraction
    await extractAndGenerate();

    // Debounced extraction for rapid changes
    const debouncedExtract = debounce(
      (path?: string) => extractAndGenerate(path),
      500
    );

    // Watch for changes
    const watcher = chokidar.watch(inputPath, {
      ignored: [
        /(^|[/\\])\../, // Hidden files
        /node_modules/,
        /\.(test|spec)\.(ts|tsx)$/, // Test files
        options.output ? resolve(process.cwd(), options.output) : '', // Output file
      ],
      persistent: true,
      ignoreInitial: true,
    });

    watcher
      .on('add', (path) => {
        if (options.verbose) {
          console.log(chalk.gray(`File added: ${path}`));
        }
        debouncedExtract(path);
      })
      .on('change', (path) => {
        if (options.verbose) {
          console.log(chalk.gray(`File changed: ${path}`));
        }
        debouncedExtract(path);
      })
      .on('unlink', (path) => {
        if (options.verbose) {
          console.log(chalk.gray(`File removed: ${path}`));
        }
        // For removals, we need full rebuild to ensure no orphaned styles
        debouncedExtract();
      })
      .on('error', (error) => {
        console.error(chalk.red('Watcher error:'), error);
      });

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log(chalk.yellow('\nShutting down watcher...'));
      watcher.close();

      // Clean up transformed theme file
      if (transformedThemePath) {
        try {
          require('fs').unlinkSync(transformedThemePath);
          const tempDir = dirname(transformedThemePath);
          if (tempDir.includes('animus-theme-')) {
            require('fs').rmdirSync(tempDir, { recursive: true });
          }
        } catch {
          // Ignore cleanup errors
        }
      }

      process.exit(0);
    });
  });
