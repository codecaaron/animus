import * as ts from 'typescript';

import { SpreadTracer } from '../extraction/spreadTracer';
import {
  createTrackedNode,
  getSourcePosition,
  StyleExtractorImpl,
} from '../extraction/styleExtractor';
import type { Logger } from '../infrastructure/logger';
import type {
  ComponentDefinition,
  ComponentUsage,
  Confidence,
  CrossFileReference,
  ExtractionContext,
  PropMap,
  PropValue,
  SpreadAnalysis,
  SpreadSource,
  UsageCollectionInput,
  UsageCollectionOptions,
  UsageCollectionOutput,
  UsageCollectionPhase,
  UsageError,
  VariableBinding,
} from '../types';

export class UsageCollectionAlgorithm implements UsageCollectionPhase {
  readonly name = 'collection' as const;

  execute(
    context: ExtractionContext,
    input: UsageCollectionInput
  ): UsageCollectionOutput {
    const logger = context.getPhaseLogger('collection');
    logger.debug('Starting usage collection', {
      componentId: input.definition.id,
    });

    const collector = new UsageCollector(
      context.program,
      context.languageService,
      context.config.phases.collection,
      logger
    );

    // Find all references to component
    const references = this.findAllReferences(
      input.definition.variableBinding,
      context.languageService
    );

    logger.debug(`Found ${references.length} references`);

    // Process each reference
    for (const ref of references) {
      const usage = collector.processReference(ref, input.definition);
      if (usage) {
        collector.addUsage(usage);
      }
    }

    logger.debug(`Collected ${collector.usages.length} usages`);

    return {
      usages: collector.usages,
      crossFileRefs: collector.crossFileRefs,
      errors: collector.errors,
    };
  }

  private findAllReferences(
    binding: VariableBinding | undefined,
    service: ts.LanguageService
  ): readonly ts.ReferenceEntry[] {
    if (!binding) return [];

    // Get the source file to search within
    const program = service.getProgram();
    if (!program) return [];

    const sourceFile = program.getSourceFile(binding.position.fileName);
    if (!sourceFile) return [];

    // For testing, let's find JSX usages manually in the same file
    const jsxUsages: ts.ReferenceEntry[] = [];
    const componentName = binding.name;

    if (sourceFile) {
      function findJsxUsages(node: ts.Node): void {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
          const tagName = node.tagName;
          if (ts.isIdentifier(tagName) && tagName.text === componentName) {
            // Found a usage
            jsxUsages.push({
              fileName: sourceFile!.fileName,
              textSpan: {
                start: tagName.getStart(),
                length: tagName.getWidth(),
              },
              isWriteAccess: false,
            } as ts.ReferenceEntry);
          }
        }

        ts.forEachChild(node, findJsxUsages);
      }

      findJsxUsages(sourceFile);
    }

    // Also try the language service approach
    const refs = service.findReferences(
      binding.position.fileName,
      binding.position.offset
    );

    const serviceRefs = refs?.flatMap((r) => r.references) ?? [];

    // Combine both approaches
    return [...jsxUsages, ...serviceRefs];
  }
}

class UsageCollector {
  readonly usages: ComponentUsage[] = [];
  readonly crossFileRefs: CrossFileReference[] = [];
  readonly errors: UsageError[] = [];

  constructor(
    private readonly program: ts.Program,
    private readonly languageService: ts.LanguageService,
    private readonly options: UsageCollectionOptions,
    private readonly logger: Logger
  ) {}

  addUsage(usage: ComponentUsage): void {
    this.usages.push(usage);
  }

  processReference(
    ref: ts.ReferenceEntry,
    definition: ComponentDefinition
  ): ComponentUsage | null {
    const sourceFile = this.program.getSourceFile(ref.fileName);
    if (!sourceFile) return null;

    const node = this.findNodeAtPosition(sourceFile, ref.textSpan.start);
    if (!node) return null;

    // Find JSX element containing this reference
    // The node should be the identifier in a JSX tag
    let jsxElement: ts.JsxElement | ts.JsxSelfClosingElement | null = null;

    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      if (
        ts.isJsxOpeningElement(parent) ||
        ts.isJsxSelfClosingElement(parent)
      ) {
        if (parent.tagName === node) {
          jsxElement = ts.isJsxOpeningElement(parent) ? parent.parent : parent;
        }
      }
    }

    if (!jsxElement) {
      jsxElement = this.findContainingJsxElement(node);
    }

    if (!jsxElement) return null;

    try {
      const props = this.analyzeProps(jsxElement);
      const spreads = this.analyzeSpreads(jsxElement);

      return {
        ...createTrackedNode(jsxElement, sourceFile),
        componentId: definition.id,
        props,
        spreads,
      };
    } catch (error) {
      this.errors.push({
        kind: 'type_error',
        location: getSourcePosition(jsxElement, sourceFile),
        message: `Failed to analyze usage: ${error}`,
      });
      return null;
    }
  }

  private findNodeAtPosition(
    sourceFile: ts.SourceFile,
    position: number
  ): ts.Node | null {
    function find(node: ts.Node): ts.Node | null {
      if (position >= node.getStart() && position < node.getEnd()) {
        const child = ts.forEachChild(node, find);
        return child || node;
      }
      return null;
    }

    return find(sourceFile);
  }

  private findContainingJsxElement(
    node: ts.Node
  ): ts.JsxElement | ts.JsxSelfClosingElement | null {
    let current: ts.Node | undefined = node;

    while (current) {
      if (ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current)) {
        return current;
      }
      current = current.parent;
    }

    return null;
  }

  private analyzeProps(
    element: ts.JsxElement | ts.JsxSelfClosingElement
  ): PropMap {
    const attributes = ts.isJsxElement(element)
      ? element.openingElement.attributes
      : element.attributes;

    const properties = new Map<string, PropValue>();

    attributes.properties.forEach((attr) => {
      if (ts.isJsxAttribute(attr) && attr.initializer) {
        const name = attr.name.getText();
        const value = ts.isJsxExpression(attr.initializer)
          ? attr.initializer.expression!
          : attr.initializer;

        properties.set(name, {
          name,
          value,
          staticValue: this.tryEvaluateStatically(value),
          type: this.program.getTypeChecker().getTypeAtLocation(value),
          confidence: this.getValueConfidence(value),
        });
      }
    });

    return { properties };
  }

  private analyzeSpreads(
    element: ts.JsxElement | ts.JsxSelfClosingElement
  ): SpreadAnalysis[] {
    const attributes = ts.isJsxElement(element)
      ? element.openingElement.attributes
      : element.attributes;

    const spreads: SpreadAnalysis[] = [];

    attributes.properties.forEach((attr) => {
      if (ts.isJsxSpreadAttribute(attr)) {
        const tracer = new SpreadTracer(
          this.program.getTypeChecker(),
          this.options.maxSpreadDepth
        );

        const source = tracer.trace(attr.expression);

        spreads.push({
          expression: attr.expression,
          source,
          confidence: this.getSpreadConfidence(source),
        });
      }
    });

    return spreads;
  }

  private tryEvaluateStatically(expr: ts.Expression): unknown {
    // Reuse the static evaluation logic from StyleExtractorImpl
    const extractor = new StyleExtractorImpl(this.program.getTypeChecker());
    return extractor['tryEvaluateStatic'](expr);
  }

  private getValueConfidence(expr: ts.Expression): Confidence {
    if (ts.isLiteralExpression(expr)) {
      return 1.0 as Confidence; // STATIC
    }
    return 0.0 as Confidence; // DYNAMIC
  }

  private getSpreadConfidence(source: SpreadSource): Confidence {
    switch (source.kind) {
      case 'object':
        return 1.0 as Confidence; // STATIC
      case 'identifier':
        return source.tracedValue ? (0.5 as Confidence) : (0.0 as Confidence); // PARTIAL : DYNAMIC
      default:
        return 0.0 as Confidence; // DYNAMIC
    }
  }
}
