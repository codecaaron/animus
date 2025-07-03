/** biome-ignore-all lint/suspicious/noConsole: <Its a CLI Stupid> */
import { existsSync } from 'fs';
import { resolve } from 'path';

import chalk from 'chalk';
import Table from 'cli-table3';
import { Command } from 'commander';
import ora from 'ora';

import { extractFromTypeScriptProject } from '../..';

interface AnalyzeOptions {
  verbose?: boolean;
  json?: boolean;
}

interface ComponentStats {
  name: string;
  file: string;
  baseStyles: number;
  variants: number;
  states: number;
  groups: string[];
  props: string[];
  usageCount: number;
  usedProps: Set<string>;
}

export const analyzeCommand = new Command('analyze')
  .description('Analyze Animus component usage patterns')
  .argument('<input>', 'Input file or directory')
  .option('-v, --verbose', 'Show detailed analysis')
  .option('--json', 'Output as JSON')
  .action(async (input: string, options: AnalyzeOptions) => {
    const spinner = ora('Analyzing components...').start();

    try {
      // Resolve input path
      const inputPath = resolve(process.cwd(), input);

      if (!existsSync(inputPath)) {
        spinner.fail(`Input path does not exist: ${inputPath}`);
        process.exit(1);
      }

      // Extract components
      const { results } = await extractFromTypeScriptProject(inputPath);

      if (results.length === 0) {
        spinner.warn('No Animus components found');
        process.exit(0);
      }

      spinner.succeed(`Analyzed ${results.length} components`);

      // Collect statistics
      const stats: ComponentStats[] = [];

      for (const result of results) {
        const { extraction, filePath, usages } = result;

        // Count style properties
        const baseStyleCount = extraction.baseStyles
          ? Object.keys(extraction.baseStyles).length
          : 0;

        // Count variants
        let variantCount = 0;
        if (extraction.variants) {
          const variantsList = Array.isArray(extraction.variants)
            ? extraction.variants
            : [extraction.variants];

          for (const v of variantsList) {
            if (v?.variants) {
              variantCount += Object.keys(v.variants).length;
            }
          }
        }

        // Count states
        const stateCount = extraction.states
          ? Object.keys(extraction.states).length
          : 0;

        // Collect used props
        const usedProps = new Set<string>();
        for (const usage of usages || []) {
          Object.keys(usage.props).forEach((prop) => usedProps.add(prop));
        }

        stats.push({
          name: extraction.componentName || 'Unknown',
          file: filePath.replace(process.cwd(), '.'),
          baseStyles: baseStyleCount,
          variants: variantCount,
          states: stateCount,
          groups: extraction.groups || [],
          props: extraction.props ? Object.keys(extraction.props) : [],
          usageCount: usages?.length || 0,
          usedProps,
        });
      }

      // Output results
      if (options.json) {
        // JSON output
        const jsonOutput = stats.map((s) => ({
          ...s,
          usedProps: Array.from(s.usedProps),
        }));
        console.log(JSON.stringify(jsonOutput, null, 2));
      } else {
        // Table output
        console.log('\n' + chalk.bold('Component Analysis Summary'));

        // Summary table
        const summaryTable = new Table({
          head: [
            'Component',
            'Styles',
            'Variants',
            'States',
            'Groups',
            'Props',
            'Usage',
          ],
          colWidths: [20, 10, 10, 10, 20, 20, 10],
        });

        for (const stat of stats) {
          summaryTable.push([
            stat.name,
            stat.baseStyles,
            stat.variants,
            stat.states,
            stat.groups.join(', ') || '-',
            stat.props.join(', ') || '-',
            stat.usageCount,
          ]);
        }

        console.log(summaryTable.toString());

        // Detailed output
        if (options.verbose) {
          console.log('\n' + chalk.bold('Detailed Component Information'));

          for (const stat of stats) {
            console.log(`\n${chalk.cyan(stat.name)} ${chalk.gray(stat.file)}`);

            if (stat.usedProps.size > 0) {
              console.log(
                `  Used props: ${Array.from(stat.usedProps).join(', ')}`
              );
            }

            // Show prop usage coverage
            if (stat.groups.length > 0 || stat.props.length > 0) {
              const allProps = [...stat.groups, ...stat.props];
              const coverage = (
                (stat.usedProps.size / allProps.length) *
                100
              ).toFixed(1);
              console.log(`  Prop coverage: ${coverage}%`);
            }
          }
        }

        // Overall statistics
        console.log('\n' + chalk.bold('Overall Statistics'));
        console.log(`  Total components: ${stats.length}`);
        console.log(
          `  Total style properties: ${stats.reduce((sum, s) => sum + s.baseStyles, 0)}`
        );
        console.log(
          `  Total variants: ${stats.reduce((sum, s) => sum + s.variants, 0)}`
        );
        console.log(
          `  Total states: ${stats.reduce((sum, s) => sum + s.states, 0)}`
        );
        console.log(
          `  Components with usage: ${stats.filter((s) => s.usageCount > 0).length}`
        );
      }
    } catch (error) {
      spinner.fail('Analysis failed');
      console.error(
        chalk.red(error instanceof Error ? error.message : String(error))
      );
      if (options.verbose && error instanceof Error) {
        console.error(chalk.gray(error.stack));
      }
      process.exit(1);
    }
  });
