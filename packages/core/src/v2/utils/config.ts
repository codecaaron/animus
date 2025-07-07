import type { ExtractorConfig } from '../types';

export function createDefaultConfig(): ExtractorConfig {
  return {
    phases: {
      discovery: {
        terminalMethods: ['asElement', 'asComponent', 'build'],
        maxDepth: 100,
        followImports: false,
      },
      reconstruction: {
        maxChainLength: 50,
        allowedMethods: ['styles', 'variant', 'states', 'extend'],
        typeResolution: 'shallow',
      },
      collection: {
        searchScope: 'file',
        maxSpreadDepth: 3,
        followDynamicImports: false,
      },
      computation: {
        mergeStrategy: 'smart',
        hashAlgorithm: 'sha256',
        includeUnused: false,
      },
    },
    errorStrategy: 'continue',
    cacheStrategy: 'memory',
    parallelism: 4,
    monitoring: true,
  };
}
