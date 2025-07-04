import type { ComponentGraph, GraphOptions, GraphSerializer as IGraphSerializer } from '../types';
import { JSONSerializer } from './json';
import { DotSerializer } from './dot';
import { MermaidSerializer } from './mermaid';
import { ASCIISerializer } from './ascii';

export class GraphSerializer implements IGraphSerializer {
  private serializers: Record<string, IGraphSerializer> = {
    json: new JSONSerializer(),
    dot: new DotSerializer(),
    mermaid: new MermaidSerializer(),
    ascii: new ASCIISerializer(),
  };

  serialize(graph: ComponentGraph, options: GraphOptions): string {
    const serializer = this.serializers[options.format];
    if (!serializer) {
      throw new Error(`Unknown format: ${options.format}`);
    }

    return serializer.serialize(graph, options);
  }
}