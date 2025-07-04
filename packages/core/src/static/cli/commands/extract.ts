/** biome-ignore-all lint/suspicious/noConsole: <Its a CLI Stupid> */
import { existsSync, unlinkSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { dirname, resolve } from 'path';

import chalk from 'chalk';
import { Command } from 'commander';
import ora from 'ora';

import { extractFromTypeScriptProject } from '../..';
import { CSSGenerator } from '../../generator';
import type { UsageMap } from '../../types';
import { buildUsageMap } from '../../usageCollector';
import { getGroupDefinitionsForComponent } from '../utils/groupDefinitions';
import { transformThemeFile } from '../utils/themeTransformer';

interface ExtractOptions {
  output?: string;
  theme?: string;
  watch?: boolean;
  atomic?: boolean;
  verbose?: boolean;
  themeMode?: 'inline' | 'css-variable' | 'hybrid';
  layered?: boolean; // Controls extension-aware layered CSS generation
}

export const extractCommand = new Command('extract')
  .description('Extract styles from Animus components')
  .argument('<input>', 'Input file or directory')
  .option('-o, --output <path>', 'Output CSS file path')
  .option('-t, --theme <path>', 'Path to theme file')
  .option('--theme-mode <mode>', 'Theme resolution mode', 'hybrid')
  .option('--no-atomic', 'Disable atomic CSS generation')
  .option('--no-layered', 'Disable extension-aware layered CSS generation')
  .option('-v, --verbose', 'Verbose output')
  .action(async (input: string, options: ExtractOptions) => {
    const spinner = ora('Initializing static extraction').start();
    let transformedThemePath: string | undefined;

    try {
      // Resolve paths
      const inputPath = resolve(process.cwd(), input);

      if (!existsSync(inputPath)) {
        spinner.fail(`Input path does not exist: ${inputPath}`);
        process.exit(1);
      }

      // Load theme if provided
      let theme = undefined;

      if (options.theme) {
        spinner.text = 'Loading theme...';
        const themePath = resolve(process.cwd(), options.theme);
        if (!existsSync(themePath)) {
          spinner.fail(`Theme file does not exist: ${themePath}`);
          process.exit(1);
        }

        try {
          // Check if it's a TypeScript file
          if (themePath.endsWith('.ts') || themePath.endsWith('.tsx')) {
            // Transform TypeScript theme to JavaScript
            transformedThemePath = transformThemeFile(themePath);
            const themeModule = await import(transformedThemePath);
            theme = themeModule.default || themeModule.theme || themeModule;
          } else {
            // Direct import for JavaScript files
            const themeModule = await import(themePath);
            theme = themeModule.default || themeModule.theme || themeModule;
          }

          if (!theme || typeof theme !== 'object') {
            spinner.fail(
              'Theme file must export a theme object as default or named "theme" export'
            );
            process.exit(1);
          }
        } catch (error) {
          spinner.fail(
            `Failed to load theme: ${error instanceof Error ? error.message : String(error)}`
          );
          process.exit(1);
        }
      }

      // Extract components and generate layered CSS
      spinner.text = 'Extracting components...';
      const { results, registry } =
        await extractFromTypeScriptProject(inputPath);

      if (results.length === 0) {
        spinner.warn('No Animus components found');
        process.exit(0);
      }

      spinner.succeed(`Found ${results.length} components`);

      // Generate CSS (layered by default, legacy mode as fallback)
      const useLayered = options.layered !== false; // Default to true
      const cssSpinner = ora(
        useLayered
          ? 'Generating layered CSS with extension-aware ordering...'
          : 'Generating CSS (legacy mode)...'
      ).start();

      const generator = new CSSGenerator({
        atomic: options.atomic !== false,
        themeResolution: { mode: options.themeMode || 'hybrid' },
      });

      let finalCSS: string;
      let usedTokens: Set<string>;

      if (useLayered) {
        // NEW: Layered CSS generation with extension-aware ordering

        // Build usage map from all results
        const allUsages = results.flatMap((r) => r.usages || []);
        const usageMap = buildUsageMap(allUsages);

        // Convert to format expected by layered generator
        const globalUsageMap: Record<string, UsageMap> = {};
        for (const [componentName, componentUsage] of Object.entries(
          usageMap
        )) {
          globalUsageMap[componentName] = { [componentName]: componentUsage };
        }

        // Collect all enabled groups from all components
        const allGroups = new Set<string>();
        for (const result of results) {
          if (result.extraction.groups) {
            result.extraction.groups.forEach((group) => allGroups.add(group));
          }
        }

        // Get group definitions for all enabled groups
        const groupDefinitions =
          allGroups.size > 0
            ? getGroupDefinitionsForComponent(Array.from(allGroups))
            : {};

        if (options.verbose) {
          console.log(
            chalk.gray(
              `  Using layered CSS generation with extension-aware ordering`
            )
          );
          console.log(
            chalk.gray(
              `  Groups enabled: ${Array.from(allGroups).join(', ') || 'none'}`
            )
          );
        }

        // Generate layered CSS
        const layeredCSS = generator.generateLayeredCSS(
          registry,
          groupDefinitions,
          theme,
          globalUsageMap
        );

        finalCSS = layeredCSS.fullCSS;
        usedTokens = layeredCSS.usedTokens;

        if (options.verbose) {
          console.log(chalk.gray(`  CSS layers generated:`));
          console.log(
            chalk.gray(
              `    - CSS Variables: ${layeredCSS.cssVariables ? 'Yes' : 'None'}`
            )
          );
          console.log(
            chalk.gray(
              `    - Base Styles: ${layeredCSS.baseStyles.length > 0 ? 'Yes' : 'None'}`
            )
          );
          console.log(
            chalk.gray(
              `    - Variant Styles: ${layeredCSS.variantStyles.length > 0 ? 'Yes' : 'None'}`
            )
          );
          console.log(
            chalk.gray(
              `    - State Styles: ${layeredCSS.stateStyles.length > 0 ? 'Yes' : 'None'}`
            )
          );
          console.log(
            chalk.gray(
              `    - Atomic Utilities: ${layeredCSS.atomicUtilities.length > 0 ? 'Yes' : 'None'}`
            )
          );
        }

        cssSpinner.succeed(
          'Layered CSS generated with extension-aware ordering'
        );
      } else {
        // LEGACY: Per-component CSS generation (backwards compatibility)

        if (options.verbose) {
          console.log(
            chalk.yellow(
              `  Using legacy CSS generation mode (no extension ordering)`
            )
          );
        }

        const allUsages = results.flatMap((r) => r.usages || []);
        const usageMap = buildUsageMap(allUsages);

        const cssChunks: string[] = [];
        const cssVariables = new Map<string, string>();
        usedTokens = new Set<string>();

        // Generate CSS for each component
        for (const result of results) {
          const { extraction, filePath } = result;

          if (options.verbose) {
            console.log(
              chalk.gray(
                `  Processing ${extraction.componentName} from ${filePath}`
              )
            );
          }

          // Get group definitions based on enabled groups
          const groupDefinitions = extraction.groups
            ? getGroupDefinitionsForComponent(extraction.groups)
            : {};

          // Generate CSS
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

        // Build final CSS (legacy format)
        let legacyCSS = '';

        // Add CSS variables if any
        if (cssVariables.size > 0) {
          const varDeclarations = Array.from(cssVariables.entries())
            .map(([varName, value]) => `  ${varName}: ${value};`)
            .join('\n');
          legacyCSS = `:root {\n${varDeclarations}\n}\n\n`;
        }

        // Add component CSS
        legacyCSS += cssChunks.join('\n\n');
        finalCSS = legacyCSS;

        cssSpinner.succeed('Legacy CSS generated (no extension ordering)');
      }

      // Output results
      if (options.output) {
        const outputPath = resolve(process.cwd(), options.output);
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, finalCSS, 'utf-8');

        console.log(chalk.green(`✨ CSS written to ${outputPath}`));

        if (options.verbose) {
          console.log(
            chalk.gray(`  Total size: ${(finalCSS.length / 1024).toFixed(2)}KB`)
          );
          console.log(chalk.gray(`  Components: ${results.length}`));

          if (useLayered) {
            const layeredCSS = generator.generateLayeredCSS(
              registry,
              {},
              theme,
              {}
            );
            console.log(
              chalk.gray(
                `  CSS variables: ${layeredCSS.cssVariables ? layeredCSS.cssVariables.split('\n').length - 2 : 0}`
              )
            );
            console.log(chalk.gray(`  Extension hierarchy respected: Yes`));
          } else {
            // For legacy mode, count CSS variables from collected map
            const cssVariables = new Map<string, string>();
            if (finalCSS.includes(':root')) {
              const rootMatch = finalCSS.match(/:root\s*{[^}]*}/);
              if (rootMatch) {
                const matches = rootMatch[0].matchAll(
                  /\s*(--[^:]+):\s*([^;]+);/g
                );
                for (const match of matches) {
                  cssVariables.set(match[1], match[2]);
                }
              }
            }
            console.log(chalk.gray(`  CSS variables: ${cssVariables.size}`));
            console.log(
              chalk.gray(`  Extension hierarchy respected: No (legacy mode)`)
            );
          }

          console.log(chalk.gray(`  Used tokens: ${usedTokens.size}`));
        }
      } else {
        // Output to stdout
        console.log('\n' + finalCSS);
      }
    } catch (error) {
      spinner.fail('Extraction failed');
      console.error(
        chalk.red(error instanceof Error ? error.message : String(error))
      );
      if (options.verbose && error instanceof Error) {
        console.error(chalk.gray(error.stack));
      }
      process.exit(1);
    } finally {
      // Clean up transformed theme file
      if (transformedThemePath) {
        try {
          unlinkSync(transformedThemePath);
          // Also try to remove the temp directory
          const tempDir = dirname(transformedThemePath);
          if (tempDir.includes('animus-theme-')) {
            require('fs').rmdirSync(tempDir, { recursive: true });
          }
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  });
