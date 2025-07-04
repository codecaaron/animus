import type { ComponentGraph, GraphOptions, GraphSerializer } from '../types';

export class JSONSerializer implements GraphSerializer {
  serialize(graph: ComponentGraph, options: GraphOptions): string {
    const output: any = {
      metadata: graph.metadata,
      nodes: [],
      edges: [],
    };

    // Convert nodes map to array
    for (const [, node] of graph.nodes) {
      const nodeData: any = {
        ...node,
      };

      // Filter based on options
      if (!options.includeThemes && node.type === 'theme') {
        continue;
      }

      output.nodes.push(nodeData);
    }

    // Filter edges based on options
    for (const edge of graph.edges) {
      if (!options.includeUsage && edge.type === 'uses') {
        continue;
      }
      if (!options.includeImports && edge.type === 'imports') {
        continue;
      }
      if (!options.includeThemes && edge.type === 'theme-reference') {
        continue;
      }

      output.edges.push(edge);
    }

    // Add statistics
    output.statistics = {
      totalNodes: output.nodes.length,
      totalEdges: output.edges.length,
      nodesByType: this.countByType(output.nodes),
      edgesByType: this.countEdgesByType(output.edges),
    };

    return JSON.stringify(output, null, 2);
  }

  private countByType(nodes: any[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const node of nodes) {
      counts[node.type] = (counts[node.type] || 0) + 1;
    }
    return counts;
  }

  private countEdgesByType(edges: any[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const edge of edges) {
      counts[edge.type] = (counts[edge.type] || 0) + 1;
    }
    return counts;
  }
}