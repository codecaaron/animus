/** biome-ignore-all lint/suspicious/noConsole: <Its a CLI Stupid> */
import { existsSync, writeFileSync } from 'fs';
import { resolve } from 'path';

import chalk from 'chalk';
import { Command } from 'commander';
import ora from 'ora';

import { extractFromTypeScriptProject } from '../..';
import { GraphBuilder } from '../../graph/builder';
import { GraphSerializer } from '../../graph/serializers/index';
import type { GraphOptions } from '../../graph/types';

interface GraphCommandOptions {
  output?: string;
  format?: 'json' | 'dot' | 'mermaid' | 'ascii';
  includeThemes?: boolean;
  includeUsage?: boolean;
  includeImports?: boolean;
  maxDepth?: number;
  verbose?: boolean;
}

export const graphCommand = new Command('graph')
  .description('Build a complete component dependency graph')
  .argument('<input>', 'Input file or directory')
  .option('-o, --output <file>', 'Output file path')
  .option(
    '-f, --format <format>',
    'Output format (json, dot, mermaid, ascii)',
    'json'
  )
  .option('--include-themes', 'Include theme references in graph')
  .option('--include-usage', 'Include component usage relationships')
  .option('--include-imports', 'Include import relationships')
  .option('--max-depth <number>', 'Maximum depth for graph traversal', parseInt)
  .option('-v, --verbose', 'Show detailed analysis')
  .action(async (input: string, options: GraphCommandOptions) => {
    const spinner = ora('Building component graph...').start();

    try {
      // Resolve input path
      const inputPath = resolve(process.cwd(), input);

      if (!existsSync(inputPath)) {
        spinner.fail(`Input path does not exist: ${inputPath}`);
        process.exit(1);
      }

      // Extract components with registry
      const { results, registry } =
        await extractFromTypeScriptProject(inputPath);

      if (results.length === 0) {
        spinner.warn('No Animus components found');
        process.exit(0);
      }

      spinner.text = 'Analyzing component relationships...';

      // Build the graph
      const builder = new GraphBuilder();

      // Add all components as nodes
      for (const result of results) {
        const component = registry.getComponentByExportName(
          result.filePath,
          result.extraction.componentName || 'default'
        );

        if (component) {
          builder.addNode({
            id: component.identity.hash,
            name: component.identity.exportName || component.identity.name,
            filePath: component.identity.filePath,
            exportName: component.identity.exportName,
            type: 'component',
            cascade: {
              position: 0, // Will be calculated
              layer: 0, // Will be calculated
            },
            metadata: {
              hasBaseStyles: !!result.extraction.baseStyles,
              hasVariants: !!result.extraction.variants,
              hasStates: !!result.extraction.states,
              hasGroups: (result.extraction.groups || []).length > 0,
              propCount: result.extraction.props
                ? Object.keys(result.extraction.props).length
                : 0,
              selectorCount: 0, // TODO: Calculate from styles
              byteSize: 0, // TODO: Calculate from generated CSS
            },
          });

          // Add extends relationships
          const dependencies = registry.getDependencies(component.identity);
          for (const dep of dependencies) {
            builder.addEdge({
              from: component.identity.hash,
              to: dep.hash,
              type: 'extends',
              metadata: {},
            });
          }

          // Add usage relationships if requested
          if (options.includeUsage && result.usages) {
            for (const usage of result.usages) {
              builder.addEdge({
                from: usage.identity.hash,
                to: component.identity.hash,
                type: 'uses',
                metadata: {
                  usageCount: 1,
                  propValues: Object.entries(usage.props).reduce(
                    (acc, [key, value]) => {
                      // Convert value to Set, handling different types
                      acc[key] = new Set(
                        Array.isArray(value) ? value : [String(value)]
                      );
                      return acc;
                    },
                    {} as Record<string, Set<string>>
                  ),
                  locations: [
                    {
                      file: usage.identity.filePath,
                      line: 0, // TODO: Extract from AST
                      column: 0,
                    },
                  ],
                },
              });
            }
          }
        }
      }

      // Build the final graph
      const graph = builder.build();
      const analysis = builder.analyze();

      spinner.succeed(
        `Built graph with ${graph.nodes.size} components and ${graph.edges.length} relationships`
      );

      // Serialize output
      const graphOptions: GraphOptions = {
        format: options.format || 'json',
        includeThemes: options.includeThemes || false,
        includeUsage: options.includeUsage || false,
        includeImports: options.includeImports || false,
        maxDepth: options.maxDepth,
      };

      const serializer = new GraphSerializer();
      const output = serializer.serialize(graph, graphOptions);

      // Write output
      if (options.output) {
        writeFileSync(options.output, output);
        console.log(chalk.green(`✓ Graph written to ${options.output}`));
      } else {
        console.log(output);
      }

      // Show analysis if verbose
      if (options.verbose) {
        console.log('\n' + chalk.bold('Graph Analysis'));
        console.log(`  Total components: ${graph.nodes.size}`);
        console.log(`  Total relationships: ${graph.edges.length}`);
        console.log(
          `  Root components: ${graph.metadata.rootComponents.length}`
        );
        console.log(
          `  Leaf components: ${graph.metadata.leafComponents.length}`
        );

        if (graph.metadata.cycleDetected) {
          console.log(chalk.yellow('  ⚠ Circular dependencies detected'));
        }

        console.log('\n' + chalk.bold('Cascade Layers'));
        for (const [layer, components] of analysis.layers) {
          console.log(`  Layer ${layer}: ${components.length} components`);
          if (options.verbose) {
            for (const componentId of components) {
              const node = graph.nodes.get(componentId);
              if (node) {
                console.log(`    - ${node.name}`);
              }
            }
          }
        }

        if (analysis.orphanComponents.length > 0) {
          console.log('\n' + chalk.bold('Orphan Components'));
          for (const componentId of analysis.orphanComponents) {
            const node = graph.nodes.get(componentId);
            if (node) {
              console.log(`  - ${node.name} (${node.filePath})`);
            }
          }
        }

        if (analysis.circularDependencies.length > 0) {
          console.log('\n' + chalk.bold('Circular Dependencies'));
          for (const cycle of analysis.circularDependencies) {
            console.log(`  Cycle: ${cycle.cycle.join(' → ')}`);
            console.log(`  Break at: ${cycle.breakPoint}`);
          }
        }
      }
    } catch (error) {
      spinner.fail('Graph building failed');
      console.error(
        chalk.red(error instanceof Error ? error.message : String(error))
      );
      if (options.verbose && error instanceof Error) {
        console.error(chalk.gray(error.stack));
      }
      process.exit(1);
    }
  });
