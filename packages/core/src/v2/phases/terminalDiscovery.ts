import * as crypto from 'crypto';

import * as ts from 'typescript';

import {
  createNodeId,
  createTrackedNode,
  getSourcePosition,
} from '../extraction/styleExtractor';
import type { Logger } from '../infrastructure/logger';
import type {
  DiscoveryError,
  ExtractionContext,
  TerminalDiscoveryInput,
  TerminalDiscoveryOptions,
  TerminalDiscoveryOutput,
  TerminalDiscoveryPhase,
  TerminalNode,
  TerminalType,
} from '../types';

export class TerminalDiscoveryAlgorithm implements TerminalDiscoveryPhase {
  readonly name = 'discovery' as const;

  execute(
    context: ExtractionContext,
    _input: TerminalDiscoveryInput
  ): TerminalDiscoveryOutput {
    const logger = context.getPhaseLogger('discovery');
    logger.debug('Starting terminal discovery');

    const visitor = new TerminalVisitor(
      context.sourceFile,
      context.typeChecker,
      context.config.phases.discovery,
      logger
    );

    ts.forEachChild(context.sourceFile, visitor.visit);

    logger.debug(`Found ${visitor.terminals.length} terminals`);

    return {
      terminals: visitor.terminals,
      errors: visitor.errors,
    };
  }
}

class TerminalVisitor {
  readonly terminals: TerminalNode[] = [];
  readonly errors: DiscoveryError[] = [];
  private readonly visited = new Set<ts.Node>();
  private depth = 0;

  constructor(
    private readonly sourceFile: ts.SourceFile,
    private readonly typeChecker: ts.TypeChecker,
    private readonly options: TerminalDiscoveryOptions,
    private readonly logger: Logger
  ) {}

  visit = (node: ts.Node): void => {
    if (this.visited.has(node)) return;
    this.visited.add(node);

    if (this.depth > this.options.maxDepth) {
      this.errors.push({
        kind: 'depth_exceeded',
        node,
        message: `Maximum depth ${this.options.maxDepth} exceeded`,
      });
      return;
    }

    this.depth++;

    if (ts.isCallExpression(node) && this.isTerminalCall(node)) {
      const terminal = this.createTerminalNode(node);
      if (terminal) {
        this.terminals.push(terminal);
      }
    }

    ts.forEachChild(node, this.visit);
    this.depth--;
  };

  private isTerminalCall(node: ts.CallExpression): boolean {
    const expression = node.expression;
    if (!ts.isPropertyAccessExpression(expression)) return false;

    const methodName = expression.name.text;
    return this.options.terminalMethods.includes(methodName as TerminalType);
  }

  private createTerminalNode(node: ts.CallExpression): TerminalNode | null {
    try {
      const methodName = (node.expression as ts.PropertyAccessExpression).name
        .text as TerminalType;
      const componentId = this.generateComponentId(node);
      const variableBinding = this.findVariableBinding(node);

      return {
        ...createTrackedNode(node, this.sourceFile),
        type: methodName,
        componentId,
        variableBinding: variableBinding
          ? createNodeId(variableBinding, this.sourceFile)
          : undefined,
      };
    } catch (error) {
      this.errors.push({
        kind: 'invalid_terminal',
        node,
        message: `Failed to create terminal node: ${error}`,
      });
      return null;
    }
  }

  private generateComponentId(node: ts.CallExpression): string {
    const position = getSourcePosition(node, this.sourceFile);
    return crypto
      .createHash('sha256')
      .update(`${position.fileName}:${position.line}:${position.column}`)
      .digest('hex')
      .substring(0, 16);
  }

  private findVariableBinding(node: ts.Node): ts.VariableDeclaration | null {
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
}
