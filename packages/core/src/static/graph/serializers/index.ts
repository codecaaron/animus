import type {
  ComponentGraph,
  GraphOptions,
  GraphSerializer as IGraphSerializer,
} from '../types';
import { ASCIISerializer } from './ascii';
import { DotSerializer } from './dot';
import { JSONSerializer } from './json';
import { MermaidSerializer } from './mermaid';

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
