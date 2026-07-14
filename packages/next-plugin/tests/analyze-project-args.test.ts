import { describe, expect, test } from 'vitest';

import {
  buildHmrAnalyzeProjectArgs,
  buildProductionAnalyzeProjectArgs,
} from '../src/analyze-project-args';

const inputs = {
  filesJson: 'next-files',
  scalesJson: 'next-scales',
  variableMapJson: 'next-variable-map',
  contextualVarsJson: 'next-contextual-vars',
  propConfigJson: 'next-prop-config',
  groupRegistryJson: 'next-group-registry',
  packageResolutionJson: 'next-package-resolution',
  emitterConfigJson: 'next-emitter-config',
  selectorAliasesJson: 'next-selector-aliases',
  globalStyleBlocksJson: 'next-global-styles',
  pathAliasesJson: 'next-path-aliases',
  keyframesJson: 'next-keyframes',
};

describe('Next analyzeProject argument construction', () => {
  test('pins all 14 production NAPI slots', () => {
    expect(buildProductionAnalyzeProjectArgs(inputs)).toEqual([
      'next-files',
      'next-scales',
      'next-variable-map',
      'next-contextual-vars',
      'next-prop-config',
      'next-group-registry',
      'next-package-resolution',
      false,
      'next-emitter-config',
      'next-selector-aliases',
      null,
      'next-global-styles',
      'next-path-aliases',
      'next-keyframes',
    ]);
  });

  test('pins all 14 HMR NAPI slots', () => {
    expect(buildHmrAnalyzeProjectArgs(inputs)).toEqual([
      'next-files',
      'next-scales',
      'next-variable-map',
      'next-contextual-vars',
      'next-prop-config',
      'next-group-registry',
      'next-package-resolution',
      true,
      'next-emitter-config',
      'next-selector-aliases',
      null,
      'next-global-styles',
      'next-path-aliases',
      'next-keyframes',
    ]);
  });
});
