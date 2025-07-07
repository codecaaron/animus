import * as ts from 'typescript';

import {
  createNodeId,
  createTrackedNode,
  StyleExtractorImpl,
} from '../extraction/styleExtractor';
import type { Logger } from '../infrastructure/logger';
import type {
  ArgumentValue,
  ChainCall,
  ChainError,
  ChainMethod,
  ChainReconstructionInput,
  ChainReconstructionOptions,
  ChainReconstructionOutput,
  ChainReconstructionPhase,
  ComponentDefinition,
  ComponentReference,
  ComponentTypeSignature,
  Confidence,
  CSSProperty,
  ExtractedPropRegistry,
  ExtractionContext,
  NodeId,
  PropConfig,
  ScopeType,
  StateMap,
  StyleMap,
  TerminalNode,
  VariantMap,
} from '../types';

export class ChainReconstructionAlgorithm implements ChainReconstructionPhase {
  readonly name = 'reconstruction' as const;

  execute(
    context: ExtractionContext,
    input: ChainReconstructionInput
  ): ChainReconstructionOutput {
    const logger = context.getPhaseLogger('reconstruction');
    logger.debug('Starting chain reconstruction', {
      terminalId: input.terminal.componentId,
    });

    const walker = new ChainWalker(
      context.sourceFile,
      context.typeChecker,
      context.config.phases.reconstruction,
      logger
    );

    // Find variable binding if not already known
    const bindingNode = input.terminal.variableBinding
      ? this.getNodeById(input.terminal.variableBinding, context.sourceFile)
      : walker.findVariableBinding(input.terminal.node);

    // Walk up chain
    const startExpression =
      bindingNode && ts.isVariableDeclaration(bindingNode)
        ? bindingNode.initializer
        : input.terminal.node;

    const chain = walker.walkChain(startExpression);
    logger.debug(`Chain length: ${chain.length}`);

    // Build component definition
    const definition = this.buildDefinition(
      chain,
      bindingNode as ts.VariableDeclaration | undefined,
      input.terminal,
      context.sourceFile,
      context.typeChecker
    );

    return {
      definition,
      errors: walker.errors,
    };
  }

  private getNodeById(
    nodeId: NodeId | undefined,
    sourceFile: ts.SourceFile
  ): ts.Node | null {
    if (!nodeId) return null;

    // Parse the node ID to get position
    // Format: "{fileName}:{line}:{column}:{nodeKind}"
    const parts = nodeId.split(':');
    if (parts.length < 3) return null;

    const line = parseInt(parts[1]);
    const column = parseInt(parts[2]);

    // Convert line/column to position
    const position = ts.getPositionOfLineAndCharacter(
      sourceFile,
      line - 1,
      column - 1
    );

    // Find node at position
    function findNode(node: ts.Node): ts.Node | null {
      if (node.getStart() <= position && position < node.getEnd()) {
        const child = ts.forEachChild(node, findNode);
        return child || node;
      }
      return null;
    }

    const foundNode = findNode(sourceFile);

    // Verify it's a variable declaration
    if (foundNode && ts.isVariableDeclaration(foundNode)) {
      return foundNode;
    }

    // Look for parent variable declaration
    let current = foundNode;
    while (current && current !== sourceFile) {
      if (ts.isVariableDeclaration(current)) {
        return current;
      }
      current = current.parent;
    }

    return null;
  }

  private buildDefinition(
    chain: readonly ChainCall[],
    binding: ts.VariableDeclaration | undefined,
    terminal: TerminalNode,
    sourceFile: ts.SourceFile,
    typeChecker: ts.TypeChecker
  ): ComponentDefinition {
    const baseStyles = this.extractBaseStyles(chain, typeChecker);
    const variants = this.extractVariants(chain, typeChecker);
    const states = this.extractStates(chain, typeChecker);
    const extendedFrom = this.extractExtends(chain, typeChecker);
    const customProps = this.extractCustomProps(chain, typeChecker);

    const variableBinding = binding
      ? {
          ...createTrackedNode(binding, sourceFile),
          name: binding.name.getText(),
          exportModifier: this.getExportModifier(binding),
          scope: this.getScope(binding),
        }
      : undefined;

    return {
      id: terminal.componentId,
      terminalNode: terminal,
      chain,
      variableBinding,
      typeSignature: this.extractTypeSignature(terminal, typeChecker),
      baseStyles,
      variants,
      states,
      extendedFrom,
      customProps,
    };
  }

  private extractBaseStyles(
    chain: readonly ChainCall[],
    typeChecker: ts.TypeChecker
  ): StyleMap {
    const stylesCall = chain.find((call) => call.method === 'styles');
    if (!stylesCall) {
      return { properties: new Map(), source: '' };
    }

    const properties = new Map<string, CSSProperty>();
    const styleExtractor = new StyleExtractorImpl(typeChecker);

    // Extract styles from the first argument (should be an object literal)
    if (stylesCall.arguments.length > 0) {
      const arg = stylesCall.arguments[0];
      const extractedStyles = styleExtractor.extractFromExpression(
        arg.expression
      );

      // Convert extracted static styles to CSSProperty format
      extractedStyles.static.forEach((cssProperty, propName) => {
        properties.set(propName, cssProperty);
      });

      // TODO: Handle dynamic styles and nested styles
    }

    return {
      properties,
      source: stylesCall.id,
    };
  }

  private extractVariants(
    chain: readonly ChainCall[],
    _typeChecker: ts.TypeChecker
  ): VariantMap {
    const variantCall = chain.find((call) => call.method === 'variant');
    if (!variantCall) {
      return { variants: new Map() };
    }

    // TODO: Extract variant configuration
    return { variants: new Map() };
  }

  private extractStates(
    chain: readonly ChainCall[],
    _typeChecker: ts.TypeChecker
  ): StateMap {
    const statesCall = chain.find((call) => call.method === 'states');
    if (!statesCall) {
      return { states: new Map() };
    }

    // TODO: Extract state configuration
    return { states: new Map() };
  }

  private extractExtends(
    chain: readonly ChainCall[],
    _typeChecker: ts.TypeChecker
  ): ComponentReference | undefined {
    const extendCall = chain.find((call) => call.method === 'extend');
    if (!extendCall) return undefined;

    // TODO: Extract parent component reference
    return undefined;
  }

  private extractCustomProps(
    chain: readonly ChainCall[],
    typeChecker: ts.TypeChecker
  ): ExtractedPropRegistry | undefined {
    const propsCall = chain.find((call) => call.method === 'props');
    if (!propsCall || propsCall.arguments.length === 0) return undefined;

    // logger.debug('Found props() call, extracting custom prop definitions');

    // Extract prop config from the first argument
    const configArg = propsCall.arguments[0];
    if (!ts.isObjectLiteralExpression(configArg.expression)) {
      // logger.warn('props() argument is not an object literal');
      return undefined;
    }

    const props = new Map<string, PropConfig>();
    const groups = new Map<string, string[]>();

    // Extract each property definition
    for (const prop of configArg.expression.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;

      const propName = prop.name?.getText();
      if (!propName) continue;

      // Extract the prop configuration
      if (ts.isObjectLiteralExpression(prop.initializer)) {
        const propConfig = this.extractPropConfig(
          propName,
          prop.initializer,
          typeChecker
        );
        if (propConfig) {
          props.set(propName, propConfig);
        }
      }
    }

    // logger.debug(`Extracted ${props.size} custom prop definitions`);

    return {
      props,
      groups,
      confidence: 1.0 as Confidence, // STATIC
    };
  }

  private extractPropConfig(
    name: string,
    node: ts.ObjectLiteralExpression,
    _typeChecker: ts.TypeChecker
  ): PropConfig | null {
    let property = '';
    let properties: string[] | undefined;
    let scale: string | undefined;
    let transform: string | undefined;

    for (const prop of node.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;

      const key = prop.name?.getText();
      const value = prop.initializer;

      switch (key) {
        case 'property':
          if (ts.isStringLiteral(value)) {
            property = value.text;
          }
          break;
        case 'properties':
          if (ts.isArrayLiteralExpression(value)) {
            properties = value.elements
              .filter(ts.isStringLiteral)
              .map((e) => e.text);
          }
          break;
        case 'scale':
          if (ts.isStringLiteral(value)) {
            scale = value.text;
          }
          break;
        case 'transform':
          // Transform could be a function name or identifier
          transform = value.getText();
          break;
      }
    }

    if (!property) return null;

    return {
      name,
      property,
      properties,
      scale,
      transform,
    };
  }

  private extractTypeSignature(
    terminal: TerminalNode,
    typeChecker: ts.TypeChecker
  ): ComponentTypeSignature {
    const type = typeChecker.getTypeAtLocation(terminal.node);

    // TODO: Extract proper type signature
    return {
      props: type,
      element: type,
      styleProps: [],
    };
  }

  private getExportModifier(
    _binding: ts.VariableDeclaration
  ): 'export' | 'export default' | undefined {
    // TODO: Check parent nodes for export modifiers
    return undefined;
  }

  private getScope(_binding: ts.VariableDeclaration): ScopeType {
    // TODO: Determine scope based on parent nodes
    return 'module';
  }
}

class ChainWalker {
  readonly errors: ChainError[] = [];

  constructor(
    private readonly sourceFile: ts.SourceFile,
    private readonly typeChecker: ts.TypeChecker,
    private readonly options: ChainReconstructionOptions,
    private readonly logger: Logger
  ) {}

  findVariableBinding(node: ts.Node): ts.VariableDeclaration | null {
    let current: ts.Node | undefined = node.parent;

    while (current) {
      if (ts.isVariableDeclaration(current) && current.initializer) {
        // Check if the initializer contains our node
        if (this.containsNode(current.initializer, node)) {
          return current;
        }
      }
      current = current.parent;
    }

    return null;
  }

  private containsNode(haystack: ts.Node, needle: ts.Node): boolean {
    if (haystack === needle) return true;

    let found = false;
    ts.forEachChild(haystack, (child) => {
      if (found) return;
      if (this.containsNode(child, needle)) {
        found = true;
      }
    });

    return found;
  }

  walkChain(expression: ts.Expression | undefined): readonly ChainCall[] {
    if (!expression) return [];

    const chain: ChainCall[] = [];
    let current = expression;
    let position = 0;

    while (current && position < this.options.maxChainLength) {
      if (ts.isCallExpression(current)) {
        const call = this.processCall(current, position);
        if (call) {
          chain.unshift(call); // Build chain in reverse order
          position++;
        }

        // Move to next in chain
        if (ts.isPropertyAccessExpression(current.expression)) {
          current = current.expression.expression;
        } else {
          break;
        }
      } else if (ts.isPropertyAccessExpression(current)) {
        current = current.expression;
      } else {
        break;
      }
    }

    // Link chain calls
    for (let i = 0; i < chain.length; i++) {
      if (i > 0) {
        (chain[i] as any).previousCall = chain[i - 1].id;
      }
      if (i < chain.length - 1) {
        (chain[i] as any).nextCall = chain[i + 1].id;
      }
    }

    return chain;
  }

  private processCall(
    node: ts.CallExpression,
    position: number
  ): ChainCall | null {
    if (!ts.isPropertyAccessExpression(node.expression)) return null;

    const methodName = node.expression.name.text;
    if (!this.isChainMethod(methodName)) return null;

    try {
      const args = this.extractArguments(node);
      const typeArgs = this.extractTypeArguments(node);

      return {
        ...createTrackedNode(node, this.sourceFile),
        method: methodName as ChainMethod,
        arguments: args,
        typeArguments: typeArgs,
        chainPosition: position,
      };
    } catch (error) {
      this.errors.push({
        kind: 'invalid_chain',
        node,
        message: `Failed to process chain call: ${error}`,
      });
      return null;
    }
  }

  private isChainMethod(name: string): boolean {
    const methods: ChainMethod[] = [
      'styles',
      'variant',
      'states',
      'groups',
      'props',
      'extend',
    ];
    return methods.includes(name as ChainMethod);
  }

  private extractArguments(call: ts.CallExpression): ArgumentValue[] {
    return call.arguments.map((arg) => ({
      expression: arg,
      type: this.typeChecker.getTypeAtLocation(arg),
      staticValue: this.tryEvaluateStatically(arg),
      confidence: this.getArgumentConfidence(arg),
    }));
  }

  private extractTypeArguments(call: ts.CallExpression): ts.Type[] {
    if (!call.typeArguments) return [];

    return call.typeArguments.map((typeArg) =>
      this.typeChecker.getTypeFromTypeNode(typeArg)
    );
  }

  private tryEvaluateStatically(expr: ts.Expression): unknown {
    // Reuse the static evaluation logic from StyleExtractorImpl
    const extractor = new StyleExtractorImpl(this.typeChecker);
    return extractor['tryEvaluateStatic'](expr);
  }

  private getArgumentConfidence(expr: ts.Expression): Confidence {
    if (ts.isLiteralExpression(expr) || ts.isObjectLiteralExpression(expr)) {
      return 1.0 as Confidence; // STATIC
    }
    if (ts.isIdentifier(expr)) {
      return 0.5 as Confidence; // PARTIAL
    }
    return 0.0 as Confidence; // DYNAMIC
  }
}
