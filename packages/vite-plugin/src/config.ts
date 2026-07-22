import { buildPathAliasesJson } from '@animus-ui/extract/pipeline';

import { resolveLightningTargets } from './css';

import type { PluginContext } from './context';
import type { ResolvedConfig } from 'vite';

/**
 * configResolved: capture build mode, root, and logger; resolve Lightning
 * CSS targets; harvest resolve.alias into the Rust `pathAliasesJson`
 * contract via the shared encoder.
 */
export function applyResolvedConfig(
  ctx: PluginContext,
  config: ResolvedConfig
): void {
  ctx.isProd = config.command === 'build';
  ctx.rootDir = config.root;
  ctx.logger = config.logger;

  // Resolve Lightning CSS browser targets once
  ctx.lcssTargets = resolveLightningTargets(ctx.options.targets, ctx.rootDir);
  ctx.log(
    `Lightning CSS targets resolved (${Object.keys(ctx.lcssTargets).length} browsers)`
  );

  // Extract path aliases from Vite's resolved config.
  // This includes aliases from vite-tsconfig-paths, manual resolve.alias, etc.
  const rawAlias = config.resolve?.alias;
  if (rawAlias) {
    const pairs: Array<{
      pattern: string;
      target: string;
      kind?: 'prefix';
    }> = [];

    if (Array.isArray(rawAlias)) {
      // Array format: [{ find: string | RegExp, replacement: string }]
      // String finds are always prefix matches — no extension sniffing.
      for (const entry of rawAlias) {
        if (
          typeof entry.find === 'string' &&
          typeof entry.replacement === 'string'
        ) {
          pairs.push({
            pattern: entry.find,
            target: entry.replacement,
            kind: 'prefix',
          });
        }
      }
    } else if (typeof rawAlias === 'object' && rawAlias !== null) {
      // Record format: { '@admin': '/abs/path/to/src' }
      for (const [key, value] of Object.entries(
        rawAlias as Record<string, unknown>
      )) {
        if (typeof value === 'string') {
          pairs.push({ pattern: key, target: value });
        }
      }
    }

    const built = buildPathAliasesJson(pairs, ctx.rootDir);
    if (built) {
      ctx.pathAliasesJson = built.json;
      ctx.log(`Path aliases forwarded: ${built.count} entries`);
    }
  }
}
