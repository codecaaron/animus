import type { ComponentGraph, GraphOptions, GraphSerializer } from '../types';

export class DotSerializer implements GraphSerializer {
  serialize(graph: ComponentGraph, options: GraphOptions): string {
    const lines: string[] = [];
    
    // Start digraph
    lines.push('digraph ComponentGraph {');
    lines.push('  rankdir=TB;');
    lines.push('  node [shape=box];');
    lines.push('');

    // Add nodes grouped by layer
    const layers = new Map<number, string[]>();
    for (const [id, node] of graph.nodes) {
      if (!options.includeThemes && node.type === 'theme') {
        continue;
      }

      const layer = node.cascade.layer;
      if (!layers.has(layer)) {
        layers.set(layer, []);
      }
      layers.get(layer)!.push(id);
    }

    // Output nodes by layer
    const sortedLayers = Array.from(layers.keys()).sort((a, b) => a - b);
    for (const layer of sortedLayers) {
      lines.push(`  subgraph cluster_layer${layer} {`);
      lines.push(`    label="Layer ${layer}";`);
      lines.push('    style=filled;');
      lines.push('    color=lightgray;');
      lines.push('    node [style=filled,color=white];');

      const nodeIds = layers.get(layer)!;
      for (const nodeId of nodeIds) {
        const node = graph.nodes.get(nodeId)!;
        const label = this.escapeLabel(node.name);
        const color = this.getNodeColor(node.type);
        
        lines.push(`    "${nodeId}" [label="${label}", fillcolor="${color}"];`);
      }

      lines.push('  }');
      lines.push('');
    }

    // Add edges
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

      const style = this.getEdgeStyle(edge.type);
      lines.push(`  "${edge.from}" -> "${edge.to}" [${style}];`);
    }

    // Close digraph
    lines.push('}');

    return lines.join('\n');
  }

  private escapeLabel(label: string): string {
    return label.replace(/"/g, '\\"');
  }

  private getNodeColor(type: string): string {
    switch (type) {
      case 'component':
        return 'lightblue';
      case 'theme':
        return 'lightgreen';
      case 'composite':
        return 'lightyellow';
      default:
        return 'white';
    }
  }

  private getEdgeStyle(type: string): string {
    switch (type) {
      case 'extends':
        return 'color=blue, style=solid, label="extends"';
      case 'uses':
        return 'color=green, style=dashed, label="uses"';
      case 'imports':
        return 'color=gray, style=dotted, label="imports"';
      case 'theme-reference':
        return 'color=purple, style=dashed, label="theme"';
      default:
        return 'color=black';
    }
  }
}