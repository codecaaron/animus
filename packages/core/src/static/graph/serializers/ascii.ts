import type { ComponentGraph, GraphOptions, GraphSerializer } from '../types';

export class ASCIISerializer implements GraphSerializer {
  serialize(graph: ComponentGraph, options: GraphOptions): string {
    const lines: string[] = [];
    
    // Header
    lines.push('Component Dependency Graph');
    lines.push('=' .repeat(80));
    lines.push('');

    // Summary
    lines.push(`Total Components: ${graph.nodes.size}`);
    lines.push(`Total Relationships: ${graph.edges.length}`);
    lines.push(`Root Components: ${graph.metadata.rootComponents.length}`);
    lines.push(`Leaf Components: ${graph.metadata.leafComponents.length}`);
    
    if (graph.metadata.cycleDetected) {
      lines.push('⚠️  Circular dependencies detected');
    }
    
    lines.push('');
    lines.push('Component Hierarchy:');
    lines.push('-'.repeat(80));

    // Build adjacency lists for tree display
    const childrenMap = new Map<string, string[]>();
    const roots = new Set(graph.metadata.rootComponents);

    for (const edge of graph.edges) {
      if (edge.type === 'extends') {
        if (!childrenMap.has(edge.to)) {
          childrenMap.set(edge.to, []);
        }
        childrenMap.get(edge.to)!.push(edge.from);
      }
    }

    // Display tree starting from roots
    const visited = new Set<string>();
    
    for (const rootId of roots) {
      const node = graph.nodes.get(rootId);
      if (node && !visited.has(rootId)) {
        this.printTree(lines, node, childrenMap, visited, graph, '', true);
      }
    }

    // Display orphan components
    const orphans: string[] = [];
    for (const [id, node] of graph.nodes) {
      if (!visited.has(id)) {
        orphans.push(node.name);
      }
    }

    if (orphans.length > 0) {
      lines.push('');
      lines.push('Orphan Components (no inheritance relationships):');
      lines.push('-'.repeat(80));
      for (const name of orphans.sort()) {
        lines.push(`  • ${name}`);
      }
    }

    // Usage statistics if requested
    if (options.includeUsage) {
      lines.push('');
      lines.push('Component Usage:');
      lines.push('-'.repeat(80));
      
      const usageCounts = new Map<string, number>();
      for (const edge of graph.edges) {
        if (edge.type === 'uses') {
          usageCounts.set(edge.to, (usageCounts.get(edge.to) || 0) + 1);
        }
      }

      const sortedUsage = Array.from(usageCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

      for (const [id, count] of sortedUsage) {
        const node = graph.nodes.get(id);
        if (node) {
          lines.push(`  ${node.name}: used ${count} times`);
        }
      }
    }

    return lines.join('\n');
  }

  private printTree(
    lines: string[],
    node: any,
    childrenMap: Map<string, string[]>,
    visited: Set<string>,
    graph: ComponentGraph,
    prefix: string,
    isLast: boolean
  ): void {
    visited.add(node.id);

    const connector = isLast ? '└── ' : '├── ';
    const extension = isLast ? '    ' : '│   ';

    lines.push(`${prefix}${connector}${node.name}`);

    const children = childrenMap.get(node.id) || [];
    for (let i = 0; i < children.length; i++) {
      const childId = children[i];
      const childNode = graph.nodes.get(childId);
      
      if (childNode && !visited.has(childId)) {
        this.printTree(
          lines,
          childNode,
          childrenMap,
          visited,
          graph,
          prefix + extension,
          i === children.length - 1
        );
      }
    }
  }
}