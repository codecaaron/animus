import type { PluginPass, types as BabelTypes } from '@babel/core';

import type { AnimusExtractOptions } from './index';

export interface ComponentData {
  id: string;
  name?: string;
  element?: string;
  styles?: Record<string, any>;
  states?: Record<string, any>;
  variants?: Record<string, any>;
  groups?: Record<string, any>;
  props?: Record<string, any>;
  className?: string;
}

export interface AnimusExtractState extends PluginPass {
  animusComponents: Map<string, ComponentData>;
  cssOutput: Map<string, string>;
  atomicClasses: Map<string, AtomicClass>;
  hasAnimusImport: boolean;
  animusBinding?: string;
  options: AnimusExtractOptions;
  types: typeof BabelTypes;
}

export interface AtomicClass {
  className: string;
  css: string;
  prop: string;
  value: any;
  breakpoint?: string;
}

export interface ExtractedChainCall {
  methodName: string;
  args: any[];
}

export interface StyleExtraction {
  static: Record<string, any>;
  dynamic: Record<string, any>;
}

export interface PropTransformation {
  className?: string;
  runtimeProps?: Record<string, any>;
}
