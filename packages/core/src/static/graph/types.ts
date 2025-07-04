export interface ComponentNode {
  id: string;
  name: string;
  filePath: string;
  exportName?: string;
  type: 'component' | 'theme' | 'composite';
  cascade: {
    position: number;
    layer: number;
  };
  metadata: {
    hasBaseStyles: boolean;
    hasVariants: boolean;
    hasStates: boolean;
    hasGroups: boolean;
    propCount: number;
    selectorCount: number;
    byteSize: number;
  };
}

export interface ComponentEdge {
  from: string;
  to: string;
  type: 'extends' | 'uses' | 'imports' | 'theme-reference';
  metadata: {
    usageCount?: number;
    propValues?: Record<string, Set<string>>;
    locations?: Array<{
      file: string;
      line: number;
      column: number;
    }>;
  };
}

export interface ComponentGraph {
  nodes: Map<string, ComponentNode>;
  edges: ComponentEdge[];
  metadata: {
    timestamp: number;
    version: string;
    rootComponents: string[];
    leafComponents: string[];
    cycleDetected: boolean;
    totalFiles: number;
    totalComponents: number;
  };
}

export interface GraphOptions {
  includeThemes: boolean;
  includeUsage: boolean;
  includeImports: boolean;
  maxDepth?: number;
  format: 'json' | 'dot' | 'mermaid' | 'ascii';
}

export interface CascadeAnalysis {
  layers: Map<number, string[]>;
  criticalPath: string[];
  orphanComponents: string[];
  circularDependencies: Array<{
    cycle: string[];
    breakPoint: string;
  }>;
}

export interface GraphSerializer {
  serialize(graph: ComponentGraph, options: GraphOptions): string;
}

export interface GraphBuilder {
  addNode(node: ComponentNode): void;
  addEdge(edge: ComponentEdge): void;
  build(): ComponentGraph;
  analyze(): CascadeAnalysis;
}