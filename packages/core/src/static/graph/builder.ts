import type {
  ComponentNode,
  ComponentEdge,
  ComponentGraph,
  CascadeAnalysis,
  GraphBuilder as IGraphBuilder,
} from './types';

export class GraphBuilder implements IGraphBuilder {
  private nodes: Map<string, ComponentNode> = new Map();
  private edges: ComponentEdge[] = [];
  private adjacencyList: Map<string, Set<string>> = new Map();
  private reverseAdjacencyList: Map<string, Set<string>> = new Map();

  addNode(node: ComponentNode): void {
    this.nodes.set(node.id, node);
    if (!this.adjacencyList.has(node.id)) {
      this.adjacencyList.set(node.id, new Set());
    }
    if (!this.reverseAdjacencyList.has(node.id)) {
      this.reverseAdjacencyList.set(node.id, new Set());
    }
  }

  addEdge(edge: ComponentEdge): void {
    this.edges.push(edge);
    
    // Update adjacency lists for efficient traversal
    if (!this.adjacencyList.has(edge.from)) {
      this.adjacencyList.set(edge.from, new Set());
    }
    if (!this.reverseAdjacencyList.has(edge.to)) {
      this.reverseAdjacencyList.set(edge.to, new Set());
    }
    
    this.adjacencyList.get(edge.from)!.add(edge.to);
    this.reverseAdjacencyList.get(edge.to)!.add(edge.from);
  }

  build(): ComponentGraph {
    // Calculate cascade positions
    this.calculateCascadePositions();

    // Find root and leaf components
    const rootComponents: string[] = [];
    const leafComponents: string[] = [];

    for (const [nodeId] of this.nodes) {
      const incoming = this.reverseAdjacencyList.get(nodeId) || new Set();
      const outgoing = this.adjacencyList.get(nodeId) || new Set();

      if (incoming.size === 0) {
        rootComponents.push(nodeId);
      }
      if (outgoing.size === 0) {
        leafComponents.push(nodeId);
      }
    }

    // Detect cycles
    const cycleDetected = this.hasCycles();

    return {
      nodes: this.nodes,
      edges: this.edges,
      metadata: {
        timestamp: Date.now(),
        version: '1.0.0',
        rootComponents,
        leafComponents,
        cycleDetected,
        totalFiles: new Set([...this.nodes.values()].map(n => n.filePath)).size,
        totalComponents: this.nodes.size,
      },
    };
  }

  analyze(): CascadeAnalysis {
    const layers = this.calculateLayers();
    const criticalPath = this.findCriticalPath();
    const orphanComponents = this.findOrphans();
    const circularDependencies = this.findCircularDependencies();

    return {
      layers,
      criticalPath,
      orphanComponents,
      circularDependencies,
    };
  }

  private calculateCascadePositions(): void {
    // Topological sort to determine cascade positions
    const visited = new Set<string>();
    const positions = new Map<string, number>();
    let currentPosition = 0;

    const visit = (nodeId: string): number => {
      if (positions.has(nodeId)) {
        return positions.get(nodeId)!;
      }

      visited.add(nodeId);
      let maxDependencyPosition = -1;

      const dependencies = this.adjacencyList.get(nodeId) || new Set();
      for (const depId of dependencies) {
        if (!visited.has(depId)) {
          const depPosition = visit(depId);
          maxDependencyPosition = Math.max(maxDependencyPosition, depPosition);
        }
      }

      const position = maxDependencyPosition + 1;
      positions.set(nodeId, position);
      
      const node = this.nodes.get(nodeId);
      if (node) {
        node.cascade.position = currentPosition++;
        node.cascade.layer = position;
      }

      return position;
    };

    // Visit all nodes
    for (const nodeId of this.nodes.keys()) {
      if (!visited.has(nodeId)) {
        visit(nodeId);
      }
    }
  }

  private calculateLayers(): Map<number, string[]> {
    const layers = new Map<number, string[]>();

    for (const [nodeId, node] of this.nodes) {
      const layer = node.cascade.layer;
      if (!layers.has(layer)) {
        layers.set(layer, []);
      }
      layers.get(layer)!.push(nodeId);
    }

    return layers;
  }

  private findCriticalPath(): string[] {
    // Find the longest path in the DAG
    const distances = new Map<string, number>();
    const predecessors = new Map<string, string | null>();

    // Initialize distances
    for (const nodeId of this.nodes.keys()) {
      distances.set(nodeId, 0);
      predecessors.set(nodeId, null);
    }

    // Calculate longest paths
    const visited = new Set<string>();
    const calculateDistance = (nodeId: string): number => {
      if (visited.has(nodeId)) {
        return distances.get(nodeId)!;
      }

      visited.add(nodeId);
      const dependencies = this.adjacencyList.get(nodeId) || new Set();
      
      for (const depId of dependencies) {
        const depDistance = calculateDistance(depId) + 1;
        if (depDistance > distances.get(nodeId)!) {
          distances.set(nodeId, depDistance);
          predecessors.set(nodeId, depId);
        }
      }

      return distances.get(nodeId)!;
    };

    // Calculate distances for all nodes
    for (const nodeId of this.nodes.keys()) {
      calculateDistance(nodeId);
    }

    // Find the node with maximum distance
    let maxDistance = 0;
    let endNode: string | null = null;

    for (const [nodeId, distance] of distances) {
      if (distance > maxDistance) {
        maxDistance = distance;
        endNode = nodeId;
      }
    }

    // Reconstruct path
    const path: string[] = [];
    let current = endNode;

    while (current !== null) {
      path.unshift(current);
      current = predecessors.get(current) || null;
    }

    return path;
  }

  private findOrphans(): string[] {
    const orphans: string[] = [];

    for (const nodeId of this.nodes.keys()) {
      const incoming = this.reverseAdjacencyList.get(nodeId) || new Set();
      const outgoing = this.adjacencyList.get(nodeId) || new Set();

      if (incoming.size === 0 && outgoing.size === 0) {
        orphans.push(nodeId);
      }
    }

    return orphans;
  }

  private hasCycles(): boolean {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const hasCycleDFS = (nodeId: string): boolean => {
      visited.add(nodeId);
      recursionStack.add(nodeId);

      const neighbors = this.adjacencyList.get(nodeId) || new Set();
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          if (hasCycleDFS(neighbor)) {
            return true;
          }
        } else if (recursionStack.has(neighbor)) {
          return true;
        }
      }

      recursionStack.delete(nodeId);
      return false;
    };

    for (const nodeId of this.nodes.keys()) {
      if (!visited.has(nodeId)) {
        if (hasCycleDFS(nodeId)) {
          return true;
        }
      }
    }

    return false;
  }

  private findCircularDependencies(): Array<{ cycle: string[]; breakPoint: string }> {
    const cycles: Array<{ cycle: string[]; breakPoint: string }> = [];
    const visited = new Set<string>();
    const recursionStack: string[] = [];

    const findCycleDFS = (nodeId: string): void => {
      visited.add(nodeId);
      recursionStack.push(nodeId);

      const neighbors = this.adjacencyList.get(nodeId) || new Set();
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          findCycleDFS(neighbor);
        } else if (recursionStack.includes(neighbor)) {
          // Found a cycle
          const cycleStart = recursionStack.indexOf(neighbor);
          const cycle = recursionStack.slice(cycleStart).concat(neighbor);
          cycles.push({
            cycle,
            breakPoint: nodeId, // The edge from nodeId to neighbor creates the cycle
          });
        }
      }

      recursionStack.pop();
    };

    for (const nodeId of this.nodes.keys()) {
      if (!visited.has(nodeId)) {
        findCycleDFS(nodeId);
      }
    }

    return cycles;
  }
}