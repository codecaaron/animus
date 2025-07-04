#!/usr/bin/env node

/**
 * Animus Static Extraction CLI
 *
 * A command-line interface for extracting, analyzing, and optimizing
 * Animus component styles at build time.
 */

import { program } from 'commander';

import { analyzeCommand } from './commands/analyze';
import { extractCommand } from './commands/extract';
import { graphCommand } from './commands/graph';
import { watchCommand } from './commands/watch';

// Version will be injected during build or read at runtime
const version = '0.2.0-beta.2';

program
  .name('animus-static')
  .description('Static extraction and optimization for Animus components')
  .version(version);

// Register commands
program.addCommand(extractCommand);
program.addCommand(analyzeCommand);
program.addCommand(watchCommand);
program.addCommand(graphCommand);

// Parse command line arguments
program.parse(process.argv);

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
