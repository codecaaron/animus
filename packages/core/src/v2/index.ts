/**
 * Static Extraction Implementation v1.0
 */

import { StaticExtractionOrchestrator } from './orchestrator';
import type { ExtractorConfig, StaticExtractor } from './types';
// Import all core types from the types module
import { createDefaultConfig } from './utils/config';

export function createStaticExtractor(
  config?: Partial<ExtractorConfig>
): StaticExtractor {
  const fullConfig = {
    ...createDefaultConfig(),
    ...config,
  };

  return new StaticExtractionOrchestrator(fullConfig);
}

// Re-export types
export * from './types';
// Re-export main factory function
