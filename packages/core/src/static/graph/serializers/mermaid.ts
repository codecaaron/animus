import type { ComponentGraph, GraphOptions, GraphSerializer } from '../types';

export class MermaidSerializer implements GraphSerializer {
  serialize(graph: ComponentGraph, options: GraphOptions): string {
    const lines: string[] = [];

    // Start graph
    lines.push('graph TB');
    lines.push('');

    // Create node ID mapping (Mermaid doesn't like complex IDs)
    const nodeIdMap = new Map<string, string>();
    let nodeCounter = 0;

    // Add nodes
    for (const [id, node] of graph.nodes) {
      if (!options.includeThemes && node.type === 'theme') {
        continue;
      }

      const mermaidId = `N${nodeCounter++}`;
      nodeIdMap.set(id, mermaidId);

      const label = this.escapeLabel(node.name);
      const shape = this.getNodeShape(node.type);

      lines.push(`  ${mermaidId}${shape}${label}${shape === '[' ? ']' : ')'}`);
    }

    lines.push('');

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

      const fromId = nodeIdMap.get(edge.from);
      const toId = nodeIdMap.get(edge.to);

      if (fromId && toId) {
        const arrow = this.getArrowStyle(edge.type);
        const label = this.getEdgeLabel(edge.type);

        lines.push(`  ${fromId} ${arrow}|${label}| ${toId}`);
      }
    }

    // Add styling
    lines.push('');
    lines.push(
      '  classDef component fill:#e1f5fe,stroke:#01579b,stroke-width:2px;'
    );
    lines.push(
      '  classDef theme fill:#f1f8e9,stroke:#33691e,stroke-width:2px;'
    );
    lines.push(
      '  classDef composite fill:#fffde7,stroke:#f57f17,stroke-width:2px;'
    );

    // Apply styles to nodes
    const componentNodes: string[] = [];
    const themeNodes: string[] = [];
    const compositeNodes: string[] = [];

    for (const [id, node] of graph.nodes) {
      const mermaidId = nodeIdMap.get(id);
      if (!mermaidId) continue;

      switch (node.type) {
        case 'component':
          componentNodes.push(mermaidId);
          break;
        case 'theme':
          themeNodes.push(mermaidId);
          break;
        case 'composite':
          compositeNodes.push(mermaidId);
          break;
      }
    }

    if (componentNodes.length > 0) {
      lines.push(`  class ${componentNodes.join(',')} component;`);
    }
    if (themeNodes.length > 0) {
      lines.push(`  class ${themeNodes.join(',')} theme;`);
    }
    if (compositeNodes.length > 0) {
      lines.push(`  class ${compositeNodes.join(',')} composite;`);
    }

    return lines.join('\n');
  }

  private escapeLabel(label: string): string {
    // Escape special characters for Mermaid
    return label.replace(/[<>&"']/g, (char) => {
      const escapes: Record<string, string> = {
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        '"': '&quot;',
        "'": '&#39;',
      };
      return escapes[char] || char;
    });
  }

  private getNodeShape(type: string): string {
    switch (type) {
      case 'component':
        return '[';
      case 'theme':
        return '((';
      case 'composite':
        return '{';
      default:
        return '[';
    }
  }

  private getArrowStyle(type: string): string {
    switch (type) {
      case 'extends':
        return '-->';
      case 'uses':
        return '-..->';
      case 'imports':
        return '-.->';
      case 'theme-reference':
        return '==>';
      default:
        return '-->';
    }
  }

  private getEdgeLabel(type: string): string {
    switch (type) {
      case 'extends':
        return 'extends';
      case 'uses':
        return 'uses';
      case 'imports':
        return 'imports';
      case 'theme-reference':
        return 'theme';
      default:
        return '';
    }
  }
}
