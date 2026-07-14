import { describe, expect, test } from 'vitest';

import { buildAnalyzeProjectArgs } from '../src/analyze-project-args';

describe('Vite analyzeProject argument construction', () => {
  test('pins all 14 production NAPI slots', () => {
    expect(
      buildAnalyzeProjectArgs({
        filesJson: 'vite-production-files',
        scalesJson: 'vite-production-scales',
        variableMapJson: 'vite-production-variable-map',
        contextualVarsJson: 'vite-production-contextual-vars',
        propConfigJson: 'vite-production-prop-config',
        groupRegistryJson: 'vite-production-group-registry',
        packageResolutionJson: 'vite-production-package-resolution',
        devMode: false,
        emitterConfigJson: 'vite-production-emitter-config',
        selectorAliasesJson: 'vite-production-selector-aliases',
        globalStyleBlocksJson: 'vite-production-global-styles',
        pathAliasesJson: 'vite-production-path-aliases',
        keyframesJson: 'vite-production-keyframes',
      })
    ).toEqual([
      'vite-production-files',
      'vite-production-scales',
      'vite-production-variable-map',
      'vite-production-contextual-vars',
      'vite-production-prop-config',
      'vite-production-group-registry',
      'vite-production-package-resolution',
      false,
      'vite-production-emitter-config',
      'vite-production-selector-aliases',
      null,
      'vite-production-global-styles',
      'vite-production-path-aliases',
      'vite-production-keyframes',
    ]);
  });

  test('pins all 14 dev NAPI slots', () => {
    expect(
      buildAnalyzeProjectArgs({
        filesJson: 'vite-dev-files',
        scalesJson: 'vite-dev-scales',
        variableMapJson: 'vite-dev-variable-map',
        contextualVarsJson: 'vite-dev-contextual-vars',
        propConfigJson: 'vite-dev-prop-config',
        groupRegistryJson: 'vite-dev-group-registry',
        packageResolutionJson: 'vite-dev-package-resolution',
        devMode: true,
        emitterConfigJson: 'vite-dev-emitter-config',
        selectorAliasesJson: 'vite-dev-selector-aliases',
        globalStyleBlocksJson: 'vite-dev-global-styles',
        pathAliasesJson: 'vite-dev-path-aliases',
        keyframesJson: 'vite-dev-keyframes',
      })
    ).toEqual([
      'vite-dev-files',
      'vite-dev-scales',
      'vite-dev-variable-map',
      'vite-dev-contextual-vars',
      'vite-dev-prop-config',
      'vite-dev-group-registry',
      'vite-dev-package-resolution',
      true,
      'vite-dev-emitter-config',
      'vite-dev-selector-aliases',
      null,
      'vite-dev-global-styles',
      'vite-dev-path-aliases',
      'vite-dev-keyframes',
    ]);
  });
});
