/**
 * Static Extraction Implementation v1.0
 * Single-file implementation for development
 */

import * as crypto from 'crypto';

import * as ts from 'typescript';

import { orderPropNames } from '../properties/orderPropNames';
import type { Prop } from '../types/config';
import type { CacheKey, CacheManager, CacheStrategy } from './cache';
import { MemoryCacheManager } from './cache';
import type {
  DiagnosticsCollector,

} from './diagnostics';
import { SimpleDiagnosticsCollector } from './diagnostics';
import type {
  ErrorHandler,
  ErrorStrategy,
  ExtractionError,
} from './errors';
import { ErrorHandlerImpl } from './errors';
import type { Logger } from './logger';
import { ConsoleLogger } from './logger';
import type {
  PerformanceMonitor,
  PerformanceReport,
} from './performance';
import { PerformanceMonitorImpl } from './performance';

// ============================================================================
// Core Data Model
// ============================================================================

// Source position tracking for all AST nodes
interface SourcePosition {
  readonly fileName: string;
  readonly line: number;
  readonly column: number;
  readonly offset: number;
}

// Unique identifier for any tracked node
type NodeId = string; // Format: "{fileName}:{line}:{column}:{nodeKind}"

// Terminal types that end a component chain
type TerminalType = 'asElement' | 'asComponent' | 'build';

// Chain methods that can appear in component definition
type ChainMethod =
  | 'styles'
  | 'variant'
  | 'states'
  | 'groups'
  | 'props'
  | 'extend';

// CSS property tracking
interface CSSProperty {
  readonly name: string;
  readonly value: string | number;
  readonly source: NodeId;
  readonly confidence: Confidence;
}

// Confidence levels for static analysis
enum Confidence {
  STATIC = 1.0, // Fully analyzable at compile time
  PARTIAL = 0.5, // Partially analyzable (e.g., known keys, unknown values)
  DYNAMIC = 0.0, // Runtime-only determination
}

// Base wrapper for all AST nodes we track
interface TrackedNode<T extends ts.Node = ts.Node> {
  readonly id: NodeId;
  readonly node: T;
  readonly position: SourcePosition;
  readonly parent?: NodeId;
}

// Terminal node representing component definition endpoints
interface TerminalNode extends TrackedNode<ts.CallExpression> {
  readonly type: TerminalType;
  readonly componentId: string; // Unique component identifier
  readonly variableBinding?: NodeId; // Reference to variable declaration
}

// Chain call representation
interface ChainCall extends TrackedNode<ts.CallExpression> {
  readonly method: ChainMethod;
  readonly arguments: readonly ArgumentValue[];
  readonly typeArguments: readonly ts.Type[];
  readonly chainPosition: number; // 0-based position in chain
  readonly nextCall?: NodeId; // Next call in chain
  readonly previousCall?: NodeId; // Previous call in chain
}

// Argument value with type information
interface ArgumentValue {
  readonly expression: ts.Expression;
  readonly type: ts.Type;
  readonly staticValue?: unknown; // If statically determinable
  readonly confidence: Confidence;
}

// Complete component definition
interface ComponentDefinition {
  readonly id: string; // Unique component identifier
  readonly terminalNode: TerminalNode;
  readonly chain: readonly ChainCall[];
  readonly variableBinding?: VariableBinding;
  readonly typeSignature: ComponentTypeSignature;
  readonly baseStyles: StyleMap;
  readonly variants: VariantMap;
  readonly states: StateMap;
  readonly extendedFrom?: ComponentReference;
  readonly customProps?: ExtractedPropRegistry; // Component-level prop overrides
}

interface VariableBinding extends TrackedNode<ts.VariableDeclaration> {
  readonly name: string;
  readonly exportModifier?: 'export' | 'export default';
  readonly scope: ScopeType;
}

type ScopeType = 'module' | 'function' | 'block';

interface ComponentTypeSignature {
  readonly props: ts.Type;
  readonly element: ts.Type;
  readonly styleProps: readonly string[];
}

interface StyleMap {
  readonly properties: ReadonlyMap<string, CSSProperty>;
  readonly source: NodeId;
}

interface VariantMap {
  readonly variants: ReadonlyMap<string, VariantDefinition>;
}

interface VariantDefinition {
  readonly options: ReadonlyMap<string, StyleMap>;
  readonly defaultOption?: string;
  readonly compound?: readonly CompoundVariant[];
}

interface CompoundVariant {
  readonly conditions: ReadonlyMap<string, string>;
  readonly styles: StyleMap;
}

interface StateMap {
  readonly states: ReadonlyMap<string, StateDefinition>;
}

interface StateDefinition {
  readonly selector: string; // e.g., ":hover", ":focus"
  readonly styles: StyleMap;
}

interface ComponentReference {
  readonly componentId: string;
  readonly importPath?: string; // If from different module
  readonly preservedMethods: readonly ChainMethod[];
}

// JSX usage of a component
interface ComponentUsage
  extends TrackedNode<ts.JsxElement | ts.JsxSelfClosingElement> {
  readonly componentId: string;
  readonly props: PropMap;
  readonly spreads: readonly SpreadAnalysis[];
  readonly children?: readonly ComponentUsage[];
}

interface PropMap {
  readonly properties: ReadonlyMap<string, PropValue>;
}

interface PropValue {
  readonly name: string;
  readonly value: ts.Expression;
  readonly staticValue?: unknown;
  readonly type: ts.Type;
  readonly confidence: Confidence;
}

interface SpreadAnalysis {
  readonly expression: ts.Expression;
  readonly source: SpreadSource;
  readonly confidence: Confidence;
}

type SpreadSource =
  | { kind: 'identifier'; symbol: ts.Symbol; tracedValue?: PropMap }
  | { kind: 'object'; properties: PropMap }
  | { kind: 'call'; returnType: ts.Type }
  | { kind: 'unknown'; reason: string };

// Final extraction result with both component and atomic CSS
interface ExtractionResult {
  readonly componentId: string;
  readonly componentClass: ComponentClass; // Base styles for component
  readonly atomicClasses: AtomicClassSet; // Atomic utilities from JSX props
  readonly dynamicProperties: readonly DynamicProperty[];
  readonly confidence: ConfidenceReport;
}

// Component CSS class (e.g., .animus-Button-b8d)
interface ComponentClass {
  readonly className: string; // e.g., "animus-Button-b8d"
  readonly baseStyles: StyleMap; // From .styles()
  readonly variants: ReadonlyMap<string, VariantClass[]>; // From .variant()
  readonly states: ReadonlyMap<string, StateClass>; // From .states()
}

interface VariantClass {
  readonly className: string; // e.g., "animus-Button-b8d-size-small"
  readonly option: string;
  readonly styles: StyleMap;
}

interface StateClass {
  readonly className: string; // e.g., "animus-Button-b8d-state-disabled"
  readonly state: string;
  readonly styles: StyleMap;
}

// Atomic utility classes from JSX props
interface AtomicClassSet {
  // Global atomic classes that can be shared across components
  readonly required: readonly AtomicClass[]; // Direct props
  readonly conditional: readonly ConditionalAtomic[]; // Responsive/conditional
  readonly potential: readonly AtomicClass[]; // From spreads

  // Component-specific atomic classes (namespaced custom props)
  readonly customRequired: readonly AtomicClass[]; // Direct custom props
  readonly customConditional: readonly ConditionalAtomic[]; // Responsive custom props
  readonly customPotential: readonly AtomicClass[]; // Custom props from spreads
}

interface AtomicClass {
  readonly className: string; // e.g., "animus-p-4", "animus-bg-red"
  readonly property: string; // CSS property name
  readonly value: string | number; // CSS value
  readonly sources: readonly NodeId[]; // JSX usage locations
}

interface ConditionalAtomic extends AtomicClass {
  readonly condition: AtomicCondition;
}

type AtomicCondition =
  | { type: 'variant'; variant: string; option: string }
  | { type: 'state'; state: string }
  | { type: 'media'; query: string }
  | { type: 'compound'; conditions: readonly AtomicCondition[] };

interface DynamicProperty {
  readonly property: string;
  readonly sources: readonly NodeId[];
  readonly reason: string;
}

interface ConfidenceReport {
  readonly overall: Confidence;
  readonly staticProperties: number;
  readonly partialProperties: number;
  readonly dynamicProperties: number;
  readonly coverage: number; // 0-1 percentage of analyzable code
}

type ExtractionPhase =
  | 'discovery'
  | 'reconstruction'
  | 'collection'
  | 'computation';

interface ThemeContext {
  readonly theme: Record<string, unknown>;
  readonly scaleKeys: Set<string>;
}

// ============================================================================
// Unified Phase Interface
// ============================================================================

interface Phase<TInput, TOutput> {
  readonly name: ExtractionPhase;

  // All phases receive context + phase-specific input
  execute(context: ExtractionContext, input: TInput): TOutput;

  // Optional validation hooks
  validateInput?(context: ExtractionContext, input: TInput): ValidationResult;
  validateOutput?(
    context: ExtractionContext,
    output: TOutput
  ): ValidationResult;
}

interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ValidationError[];
  readonly warnings: readonly ValidationWarning[];
}

interface ValidationError {
  readonly message: string;
  readonly path?: string;
  readonly value?: unknown;
}

interface ValidationWarning {
  readonly message: string;
  readonly suggestion?: string;
}

// ============================================================================
// Phase Contracts
// ============================================================================

interface TerminalDiscoveryPhase
  extends Phase<TerminalDiscoveryInput, TerminalDiscoveryOutput> {
  readonly name: 'discovery';
}

interface TerminalDiscoveryInput {
  // Empty - everything needed is in context
}

interface TerminalDiscoveryOutput {
  readonly terminals: readonly TerminalNode[];
  readonly errors: readonly DiscoveryError[];
}

interface TerminalDiscoveryOptions {
  readonly terminalMethods: readonly TerminalType[];
  readonly maxDepth: number;
  readonly followImports: boolean;
}

interface DiscoveryError {
  readonly kind: 'invalid_terminal' | 'type_error' | 'depth_exceeded';
  readonly node: ts.Node;
  readonly message: string;
}

interface ChainReconstructionPhase
  extends Phase<ChainReconstructionInput, ChainReconstructionOutput> {
  readonly name: 'reconstruction';
}

interface ChainReconstructionInput {
  readonly terminal: TerminalNode;
}

interface ChainReconstructionOutput {
  readonly definition: ComponentDefinition;
  readonly errors: readonly ChainError[];
}

interface ChainReconstructionOptions {
  readonly maxChainLength: number;
  readonly allowedMethods: readonly ChainMethod[];
  readonly typeResolution: TypeResolutionStrategy;
}

type TypeResolutionStrategy = 'full' | 'shallow' | 'none';

interface ChainError {
  readonly kind: 'invalid_chain' | 'type_mismatch' | 'circular_reference';
  readonly node: ts.Node;
  readonly message: string;
}

interface UsageCollectionPhase
  extends Phase<UsageCollectionInput, UsageCollectionOutput> {
  readonly name: 'collection';
}

interface UsageCollectionInput {
  readonly definition: ComponentDefinition;
}

interface UsageCollectionOutput {
  readonly usages: readonly ComponentUsage[];
  readonly crossFileRefs: readonly CrossFileReference[];
  readonly errors: readonly UsageError[];
}

interface UsageCollectionOptions {
  readonly searchScope: SearchScope;
  readonly maxSpreadDepth: number;
  readonly followDynamicImports: boolean;
}

type SearchScope = 'file' | 'project' | 'workspace';

interface CrossFileReference {
  readonly fromFile: string;
  readonly toFile: string;
  readonly componentId: string;
  readonly importStatement: ts.ImportDeclaration;
}

interface UsageError {
  readonly kind:
    | 'unresolved_reference'
    | 'spread_depth_exceeded'
    | 'type_error';
  readonly location: SourcePosition;
  readonly message: string;
}

interface AtomicComputationPhase
  extends Phase<AtomicComputationInput, AtomicComputationOutput> {
  readonly name: 'computation';
}

interface AtomicComputationInput {
  readonly definition: ComponentDefinition;
  readonly usages: readonly ComponentUsage[];
}

interface AtomicComputationOutput {
  readonly result: ExtractionResult;
  readonly stats: ComputationStats;
}

interface AtomicComputationOptions {
  readonly mergeStrategy: MergeStrategy;
  readonly hashAlgorithm: HashAlgorithm;
  readonly includeUnused: boolean;
}

type MergeStrategy = 'union' | 'intersection' | 'smart';
type HashAlgorithm = 'xxhash' | 'murmur3' | 'sha256';

interface ComputationStats {
  readonly totalProperties: number;
  readonly uniqueAtomics: number;
  readonly duplicatesRemoved: number;
  readonly executionTimeMs: number;
}

// ============================================================================
// Extraction Context
// ============================================================================

interface ExtractionContext {
  // Core TypeScript utilities
  readonly typeChecker: ts.TypeChecker;
  readonly program: ts.Program;
  readonly languageService: ts.LanguageService;
  readonly sourceFile: ts.SourceFile;

  // Mutable state for phase tracking
  currentPhase: ExtractionPhase;

  // Accumulated data (phases can read/write)
  readonly symbolTable: Map<ts.Symbol, SymbolInfo>;
  readonly componentRegistry: Map<string, ComponentDefinition>;
  readonly usageRegistry: Map<string, ComponentUsage[]>;

  // Configuration
  readonly config: ExtractorConfig;
  readonly propRegistry: PropRegistry | null;
  readonly theme?: Record<string, unknown>;

  // Services (phases can use these)
  readonly logger: Logger;
  readonly diagnostics: DiagnosticsCollector;
  readonly monitor: PerformanceMonitor;
  readonly errorHandler: ErrorHandler;
  readonly cache: CacheManager;

  // Phase-specific loggers
  getPhaseLogger(phase: string): Logger;
}

interface SymbolInfo {
  readonly symbol: ts.Symbol;
  readonly declarations: ts.Declaration[];
  readonly type: ts.Type;
  readonly value?: unknown;
}

// ============================================================================
// Infrastructure Contracts
// ============================================================================

interface ExtractorConfig {
  readonly phases: {
    readonly discovery: TerminalDiscoveryOptions;
    readonly reconstruction: ChainReconstructionOptions;
    readonly collection: UsageCollectionOptions;
    readonly computation: AtomicComputationOptions;
  };
  readonly errorStrategy: ErrorStrategy;
  readonly cacheStrategy: CacheStrategy;
  readonly parallelism: number;
  readonly monitoring: boolean;
}

// ============================================================================
// PropRegistry Interfaces
// ============================================================================

interface PropRegistry {
  readonly props: Map<string, PropConfig>;
  readonly groups: Map<string, string[]>;
  readonly source: PropRegistrySource;
}

type PropRegistrySource =
  | { kind: 'default' }
  | { kind: 'import'; path: string }
  | { kind: 'custom'; description: string };

// ============================================================================
// Style Extraction Interfaces
// ============================================================================

// Prop Registry extraction from component types
interface PropRegistryExtractor {
  extractFromType(
    componentType: ts.Type,
    typeChecker: ts.TypeChecker
  ): ExtractedPropRegistry | null;
}

interface ExtractedPropRegistry {
  readonly props: Map<string, PropConfig>;
  readonly groups: Map<string, string[]>; // group name -> prop names
  readonly confidence: Confidence;
}

interface PropConfig {
  readonly name: string;
  readonly property: string; // CSS property name
  readonly properties?: string[]; // Multiple CSS properties
  readonly scale?: string; // Theme scale name
  readonly transform?: string; // Transform function name
}

// Theme extraction from context or imports
interface ThemeExtractor {
  extractFromProgram(program: ts.Program): ExtractedTheme | null;
  extractFromType(
    themeType: ts.Type,
    typeChecker: ts.TypeChecker
  ): ExtractedTheme | null;
}

interface ExtractedTheme {
  readonly scales: Map<string, ThemeScale>;
  readonly source: ThemeSource;
  readonly confidence: Confidence;
}

interface ThemeScale {
  readonly name: string;
  readonly values: Map<string | number, unknown>;
  readonly isArray: boolean;
}

type ThemeSource =
  | { kind: 'context'; providerType: ts.Type }
  | { kind: 'styled'; emotionTheme: ts.Type }
  | { kind: 'import'; importPath: string }
  | { kind: 'inline'; node: ts.Node };

// Style object extraction from AST nodes
interface StyleExtractor {
  extractFromObjectLiteral(
    node: ts.ObjectLiteralExpression,
    typeChecker: ts.TypeChecker
  ): ExtractedStyles;
  extractFromExpression(
    expr: ts.Expression,
    typeChecker: ts.TypeChecker
  ): ExtractedStyles;
}

interface ExtractedStyles {
  readonly static: Map<string, CSSProperty>; // Fully static properties
  readonly dynamic: Map<string, DynamicStyle>; // Runtime properties
  readonly nested: Map<string, ExtractedStyles>; // Nested selectors like &:hover
  readonly confidence: Confidence;
}

interface DynamicStyle {
  readonly property: string;
  readonly expression: ts.Expression;
  readonly possibleValues?: unknown[]; // If we can determine possible values
  readonly reason: string;
}

// Prop value resolution through registry and theme
interface PropResolver {
  resolveProp(
    propName: string,
    value: unknown,
    registry: ExtractedPropRegistry,
    theme: ExtractedTheme | null
  ): ResolvedProp | null;
}

interface ResolvedProp {
  readonly cssProperties: Map<string, string | number>; // property -> value
  readonly source: PropSource;
  readonly confidence: Confidence;
}

type PropSource =
  | { kind: 'static'; value: unknown }
  | { kind: 'theme'; scale: string; token: string | number }
  | { kind: 'transform'; function: string; input: unknown; output: unknown }
  | { kind: 'dynamic'; expression: ts.Expression };

// Type cache for expensive type extractions
interface TypeCache {
  readonly propRegistries: WeakMap<ts.Type, ExtractedPropRegistry>;
  readonly themes: WeakMap<ts.Type, ExtractedTheme>;
  readonly componentConfigs: WeakMap<ts.Type, ComponentConfig>;
}

interface ComponentConfig {
  readonly propRegistry: ExtractedPropRegistry;
  readonly theme: ExtractedTheme | null;
  readonly chainMethods: ChainMethod[];
  readonly timestamp: number;
}

// ============================================================================
// Style Extraction Implementation
// ============================================================================

class StyleExtractorImpl implements StyleExtractor {
  constructor(private readonly typeChecker: ts.TypeChecker) {}

  extractFromObjectLiteral(node: ts.ObjectLiteralExpression): ExtractedStyles {
    const staticProps = new Map<string, CSSProperty>();
    const dynamicProps = new Map<string, DynamicStyle>();
    const nestedStyles = new Map<string, ExtractedStyles>();
    let overallConfidence = Confidence.STATIC;

    for (const prop of node.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;

      const propName = this.getPropertyName(prop);
      if (!propName) {
        overallConfidence = Math.min(overallConfidence, Confidence.DYNAMIC);
        continue;
      }

      // Handle nested selectors like &:hover
      if (propName.startsWith('&') || propName.startsWith(':')) {
        if (ts.isObjectLiteralExpression(prop.initializer)) {
          nestedStyles.set(
            propName,
            this.extractFromObjectLiteral(prop.initializer)
          );
        }
        continue;
      }

      // Try to evaluate the value statically
      const staticValue = this.tryEvaluateStatic(prop.initializer);

      // Check if it's a responsive value (array or object with breakpoint keys)
      if (this.isResponsiveStyleValue(staticValue)) {
        // For styles blocks, responsive values are handled differently
        // They generate media queries within the same class
        staticProps.set(propName, {
          name: propName,
          value: staticValue as any, // Preserve the responsive structure
          source: createNodeId(prop, prop.getSourceFile() as ts.SourceFile),
          confidence: Confidence.STATIC,
        });
      } else if (staticValue !== undefined && staticValue !== null) {
        staticProps.set(propName, {
          name: propName,
          value: staticValue as string | number,
          source: createNodeId(prop, prop.getSourceFile() as ts.SourceFile),
          confidence: Confidence.STATIC,
        });
      } else {
        dynamicProps.set(propName, {
          property: propName,
          expression: prop.initializer,
          reason: 'Non-literal value',
        });
        overallConfidence = Math.min(overallConfidence, Confidence.PARTIAL);
      }
    }

    // Sort properties by CSS precedence order
    const sortedStaticProps = this.sortStyleProperties(staticProps);
    const sortedDynamicProps = this.sortStyleProperties(dynamicProps);

    return {
      static: sortedStaticProps,
      dynamic: sortedDynamicProps,
      nested: nestedStyles,
      confidence: overallConfidence,
    };
  }

  extractFromExpression(expr: ts.Expression): ExtractedStyles {
    if (ts.isObjectLiteralExpression(expr)) {
      return this.extractFromObjectLiteral(expr);
    }

    // Handle other expression types
    return {
      static: new Map(),
      dynamic: new Map([
        [
          '_expression',
          {
            property: '_expression',
            expression: expr,
            reason: 'Non-object literal expression',
          },
        ],
      ]),
      nested: new Map(),
      confidence: Confidence.DYNAMIC,
    };
  }

  private getPropertyName(prop: ts.PropertyAssignment): string | null {
    if (ts.isIdentifier(prop.name)) {
      return prop.name.text;
    }
    if (ts.isStringLiteral(prop.name)) {
      return prop.name.text;
    }
    // Computed property - try to evaluate
    if (ts.isComputedPropertyName(prop.name)) {
      const value = this.tryEvaluateStatic(prop.name.expression);
      if (typeof value === 'string' || typeof value === 'number') {
        return String(value);
      }
    }
    return null;
  }

  private isResponsiveStyleValue(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;

    // Check for array syntax: MediaQueryArray<T>
    if (Array.isArray(value)) {
      // Arrays in styles are responsive arrays
      return value.length > 0;
    }

    // Check for object syntax: MediaQueryMap<T>
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const keys = Object.keys(value);
      // Check if it has breakpoint keys from MediaQueryMap
      const breakpointKeys = ['_', 'xs', 'sm', 'md', 'lg', 'xl'];
      return keys.some((key) => breakpointKeys.includes(key));
    }

    return false;
  }

  private tryEvaluateStatic(
    expr: ts.Expression
  ):
    | string
    | number
    | boolean
    | null
    | undefined
    | any[]
    | Record<string, any> {
    // String literal
    if (ts.isStringLiteral(expr)) {
      return expr.text;
    }

    // Number literal
    if (ts.isNumericLiteral(expr)) {
      return Number(expr.text);
    }

    // Boolean literal
    if (expr.kind === ts.SyntaxKind.TrueKeyword) {
      return true;
    }
    if (expr.kind === ts.SyntaxKind.FalseKeyword) {
      return false;
    }

    // Null literal
    if (expr.kind === ts.SyntaxKind.NullKeyword) {
      return null;
    }

    // Template literal with no expressions
    if (ts.isNoSubstitutionTemplateLiteral(expr)) {
      return expr.text;
    }

    // Array literal (for responsive array syntax)
    if (ts.isArrayLiteralExpression(expr)) {
      const elements: any[] = [];
      for (const element of expr.elements) {
        const value = this.tryEvaluateStatic(element);
        elements.push(value);
      }
      return elements;
    }

    // Object literal (for responsive object syntax)
    if (ts.isObjectLiteralExpression(expr)) {
      const obj: Record<string, any> = {};
      for (const prop of expr.properties) {
        if (ts.isPropertyAssignment(prop)) {
          const key = prop.name?.getText();
          if (key && prop.initializer) {
            const value = this.tryEvaluateStatic(prop.initializer);
            obj[key] = value;
          }
        }
      }
      return obj;
    }

    // Prefix unary expression (e.g., -5)
    if (ts.isPrefixUnaryExpression(expr)) {
      const value = this.tryEvaluateStatic(expr.operand);
      if (
        typeof value === 'number' &&
        expr.operator === ts.SyntaxKind.MinusToken
      ) {
        return -value;
      }
    }

    // Binary expression (e.g., 10 + 5)
    if (ts.isBinaryExpression(expr)) {
      const left = this.tryEvaluateStatic(expr.left);
      const right = this.tryEvaluateStatic(expr.right);

      if (typeof left === 'number' && typeof right === 'number') {
        switch (expr.operatorToken.kind) {
          case ts.SyntaxKind.PlusToken:
            return left + right;
          case ts.SyntaxKind.MinusToken:
            return left - right;
          case ts.SyntaxKind.AsteriskToken:
            return left * right;
          case ts.SyntaxKind.SlashToken:
            return left / right;
        }
      }

      if (
        typeof left === 'string' &&
        typeof right === 'string' &&
        expr.operatorToken.kind === ts.SyntaxKind.PlusToken
      ) {
        return left + right;
      }
    }

    // Can't evaluate statically
    return undefined;
  }

  private sortStyleProperties<T extends { [key: string]: any }>(
    props: Map<string, T>
  ): Map<string, T> {
    // Create a simple prop config for CSS properties
    const propConfig: Record<string, Prop> = {};

    props.forEach((_, propName) => {
      // For CSS properties in styles/variants/states, we use the property name directly
      propConfig[propName] = {
        property: propName as any,
      };
    });

    // Get ordered property names
    const orderedNames = orderPropNames(propConfig);

    // Create new sorted map
    const sorted = new Map<string, T>();

    // Add properties in order
    orderedNames.forEach((name) => {
      const value = props.get(name);
      if (value) {
        sorted.set(name, value);
      }
    });

    // Add any properties that weren't in the ordered list
    props.forEach((value, key) => {
      if (!sorted.has(key)) {
        sorted.set(key, value);
      }
    });

    return sorted;
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

function createNodeId(node: ts.Node, sourceFile: ts.SourceFile): NodeId {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(
    node.getStart()
  );
  return `${sourceFile.fileName}:${line + 1}:${character + 1}:${ts.SyntaxKind[node.kind]}`;
}

function getSourcePosition(
  node: ts.Node,
  sourceFile: ts.SourceFile
): SourcePosition {
  const start = node.getStart();
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(start);
  return {
    fileName: sourceFile.fileName,
    line: line + 1,
    column: character + 1,
    offset: start,
  };
}

function createTrackedNode<T extends ts.Node>(
  node: T,
  sourceFile: ts.SourceFile,
  parent?: NodeId
): TrackedNode<T> {
  return {
    id: createNodeId(node, sourceFile),
    node,
    position: getSourcePosition(node, sourceFile),
    parent,
  };
}

// ============================================================================
// Phase 1: Terminal Discovery Implementation
// ============================================================================

class TerminalDiscoveryAlgorithm implements TerminalDiscoveryPhase {
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

// ============================================================================
// Phase 2: Upward Chain Reconstruction Implementation
// ============================================================================

class ChainReconstructionAlgorithm implements ChainReconstructionPhase {
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
      confidence: Confidence.STATIC,
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
      return Confidence.STATIC;
    }
    if (ts.isIdentifier(expr)) {
      return Confidence.PARTIAL;
    }
    return Confidence.DYNAMIC;
  }
}

// ============================================================================
// Phase 3: Downward Usage Collection Implementation
// ============================================================================

class UsageCollectionAlgorithm implements UsageCollectionPhase {
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
      return Confidence.STATIC;
    }
    return Confidence.DYNAMIC;
  }

  private getSpreadConfidence(source: SpreadSource): Confidence {
    switch (source.kind) {
      case 'object':
        return Confidence.STATIC;
      case 'identifier':
        return source.tracedValue ? Confidence.PARTIAL : Confidence.DYNAMIC;
      default:
        return Confidence.DYNAMIC;
    }
  }
}

class SpreadTracer {
  constructor(
    private readonly typeChecker: ts.TypeChecker,
    private readonly maxDepth: number
  ) {}

  trace(expression: ts.Expression, depth: number = 0): SpreadSource {
    if (depth > this.maxDepth) {
      return { kind: 'unknown', reason: 'Max depth exceeded' };
    }

    if (ts.isIdentifier(expression)) {
      return this.traceIdentifier(expression, depth);
    }

    if (ts.isObjectLiteralExpression(expression)) {
      return this.traceObject(expression);
    }

    if (ts.isCallExpression(expression)) {
      return this.traceCall(expression, depth);
    }

    return { kind: 'unknown', reason: 'Unsupported expression type' };
  }

  private traceIdentifier(id: ts.Identifier, _depth: number): SpreadSource {
    const symbol = this.typeChecker.getSymbolAtLocation(id);
    if (!symbol) {
      return { kind: 'unknown', reason: 'No symbol found' };
    }

    // TODO: Trace identifier to its definition
    return { kind: 'identifier', symbol };
  }

  private traceObject(_obj: ts.ObjectLiteralExpression): SpreadSource {
    const properties = new Map<string, PropValue>();

    // TODO: Extract properties from object literal

    return { kind: 'object', properties: { properties } };
  }

  private traceCall(call: ts.CallExpression, _depth: number): SpreadSource {
    const returnType = this.typeChecker.getTypeAtLocation(call);
    return { kind: 'call', returnType };
  }
}

// ============================================================================
// Phase 4: Atomic Set Computation Implementation
// ============================================================================

class AtomicComputationAlgorithm implements AtomicComputationPhase {
  readonly name = 'computation' as const;
  private readonly valueResolver: StyleValueResolver;

  constructor() {
    this.valueResolver = new StyleValueResolverImpl();
  }

  execute(
    context: ExtractionContext,
    input: AtomicComputationInput
  ): AtomicComputationOutput {
    const logger = context.getPhaseLogger('computation');
    logger.debug('Starting atomic computation', {
      componentId: input.definition.id,
      usageCount: input.usages.length,
    });

    const startTime = performance.now();

    // Generate component class from definition
    const componentClass = this.generateComponentClass(input.definition);
    logger.debug('Generated component class', {
      className: componentClass.className,
    });

    // Extract atomic classes from JSX usage only
    const atomicClasses = this.extractAtomicClasses(
      input.usages,
      context,
      input.definition
    );
    logger.debug('Extracted atomic classes', {
      required: atomicClasses.required.length,
      conditional: atomicClasses.conditional.length,
      customRequired: atomicClasses.customRequired.length,
      customConditional: atomicClasses.customConditional.length,
    });

    // Identify dynamic properties
    const dynamicProperties = this.identifyDynamicProperties(
      input.usages,
      input.definition,
      context
    );

    // Build final result
    const result: ExtractionResult = {
      componentId: input.definition.id,
      componentClass,
      atomicClasses,
      dynamicProperties,
      confidence: this.calculateConfidence(
        [...atomicClasses.required, ...atomicClasses.customRequired],
        dynamicProperties
      ),
    };

    const totalAtomics =
      atomicClasses.required.length + atomicClasses.customRequired.length;

    const stats: ComputationStats = {
      totalProperties: this.countProperties(componentClass) + totalAtomics,
      uniqueAtomics: totalAtomics,
      duplicatesRemoved: 0,
      executionTimeMs: performance.now() - startTime,
    };

    return { result, stats };
  }

  private generateComponentClass(
    definition: ComponentDefinition
  ): ComponentClass {
    const componentName = this.getComponentName(definition);
    const hash = this.generateHash('component', definition.id).substring(0, 3);
    const className = `animus-${componentName}-${hash}`;

    // Generate variant classes
    const variants = new Map<string, VariantClass[]>();
    definition.variants.variants.forEach((variant, variantName) => {
      const variantClasses: VariantClass[] = [];
      variant.options.forEach((styleMap, optionName) => {
        variantClasses.push({
          className: `${className}-${variantName}-${optionName}`,
          option: optionName,
          styles: styleMap,
        });
      });
      variants.set(variantName, variantClasses);
    });

    // Generate state classes
    const states = new Map<string, StateClass>();
    definition.states.states.forEach((state, stateName) => {
      states.set(stateName, {
        className: `${className}-state-${stateName}`,
        state: stateName,
        styles: state.styles,
      });
    });

    return {
      className,
      baseStyles: definition.baseStyles,
      variants,
      states,
    };
  }

  private extractAtomicClasses(
    usages: readonly ComponentUsage[],
    context: ExtractionContext,
    componentDef: ComponentDefinition
  ): AtomicClassSet {
    // Use component's custom props if available, otherwise fall back to global registry
    const effectiveRegistry = this.getEffectiveRegistry(
      componentDef,
      context.propRegistry
    );

    if (!effectiveRegistry) {
      context.logger.warn(
        'No PropRegistry available, skipping atomic extraction'
      );
      return {
        required: [],
        conditional: [],
        potential: [],
        customRequired: [],
        customConditional: [],
        customPotential: [],
      };
    }

    const atomicMap = new Map<string, AtomicClass>();
    const conditionalMap = new Map<string, ConditionalAtomic>();
    const customAtomicMap = new Map<string, AtomicClass>();
    const customConditionalMap = new Map<string, ConditionalAtomic>();

    for (const usage of usages) {
      usage.props.properties.forEach((propValue, propName) => {
        // Check if this is a style prop using PropRegistry
        const propConfig = effectiveRegistry.props.get(propName);
        if (!propConfig) {
          // Not a style prop
          return;
        }

        // Skip dynamic values
        if (
          propValue.staticValue === undefined ||
          propValue.staticValue === null
        )
          return;

        // Use the value resolver to handle theme tokens, scales, and transforms
        const resolutionContext: ResolutionContext = {
          theme: context.theme,
          propRegistry: effectiveRegistry,
          componentId: componentDef.id,
          logger: context.logger.child('resolver'),
        };

        const resolved = this.valueResolver.resolve(
          propValue.staticValue,
          propConfig,
          resolutionContext
        );

        // Skip if we couldn't resolve to a static value
        if (resolved.confidence === Confidence.DYNAMIC) {
          context.logger.warn('Skipping dynamic value', {
            prop: propName,
            value: propValue.staticValue,
          });
          return;
        }

        const value = String(resolved.value);

        // Handle props with multiple CSS properties (e.g., mx -> marginLeft, marginRight)
        const cssProperties = propConfig.properties || [propConfig.property];

        cssProperties.forEach((cssProperty) => {
          // Check if this prop is defined in the component's custom props
          const isCustomProp =
            componentDef.customProps?.props.has(propName) || false;

          const className = isCustomProp
            ? this.generateNamespacedAtomicClassName(
                propName,
                value,
                componentDef
              )
            : this.generateAtomicClassName(propName, value);

          // Convert camelCase to kebab-case for CSS
          const kebabProperty = this.toKebabCase(cssProperty);
          const key = `${cssProperty}:${value}`;

          const atomic: AtomicClass = {
            className,
            property: kebabProperty,
            value,
            sources: [usage.id],
          };

          // Check if this is a responsive value
          if (this.isResponsiveValue(propValue.staticValue)) {
            this.handleResponsiveProp(
              propName,
              propValue,
              propConfig,
              cssProperty,
              componentDef,
              usage,
              isCustomProp,
              atomicMap,
              conditionalMap,
              customAtomicMap,
              customConditionalMap,
              context
            );
            return; // Skip regular atomic handling
          }

          // Add to appropriate map based on whether it's a custom prop
          if (isCustomProp) {
            const customKey = `${key}:${componentDef.id}`;
            const existing = customAtomicMap.get(customKey);
            if (existing) {
              // Merge sources
              customAtomicMap.set(customKey, {
                ...existing,
                sources: [...existing.sources, ...atomic.sources],
              });
            } else {
              customAtomicMap.set(customKey, atomic);
            }
          } else {
            const existing = atomicMap.get(key);
            if (existing) {
              // Merge sources
              atomicMap.set(key, {
                ...existing,
                sources: [...existing.sources, ...atomic.sources],
              });
            } else {
              atomicMap.set(key, atomic);
            }
          }
        });
      });
    }

    // Sort atomic classes by CSS property order
    const sortedAtomics = this.sortAtomicClasses(
      Array.from(atomicMap.values()),
      context.propRegistry
    );

    const sortedCustomAtomics = this.sortAtomicClasses(
      Array.from(customAtomicMap.values()),
      effectiveRegistry
    );

    return {
      required: sortedAtomics,
      conditional: Array.from(conditionalMap.values()),
      potential: [], // From spread analysis
      customRequired: sortedCustomAtomics,
      customConditional: Array.from(customConditionalMap.values()),
      customPotential: [], // From spread analysis
    };
  }

  private countProperties(componentClass: ComponentClass): number {
    let count = componentClass.baseStyles.properties.size;

    componentClass.variants.forEach((variantClasses) => {
      variantClasses.forEach((vc) => {
        count += vc.styles.properties.size;
      });
    });

    componentClass.states.forEach((stateClass) => {
      count += stateClass.styles.properties.size;
    });

    return count;
  }

  private getComponentName(definition: ComponentDefinition): string {
    // Try to get component name from variable binding
    if (definition.variableBinding) {
      return definition.variableBinding.name;
    }

    // Fallback to generic name
    return 'Component';
  }

  private generateAtomicClassName(prop: string, value: string): string {
    // Map common prop names to short versions
    const propMap: Record<string, string> = {
      margin: 'm',
      marginTop: 'mt',
      marginBottom: 'mb',
      marginLeft: 'ml',
      marginRight: 'mr',
      marginX: 'mx',
      marginY: 'my',
      padding: 'p',
      paddingTop: 'pt',
      paddingBottom: 'pb',
      paddingLeft: 'pl',
      paddingRight: 'pr',
      paddingX: 'px',
      paddingY: 'py',
      backgroundColor: 'bg',
      color: 'color',
      fontSize: 'fontSize',
      fontWeight: 'fontWeight',
      lineHeight: 'lineHeight',
      letterSpacing: 'letterSpacing',
      textAlign: 'textAlign',
      width: 'w',
      height: 'h',
      minWidth: 'minW',
      maxWidth: 'maxW',
      minHeight: 'minH',
      maxHeight: 'maxH',
      display: 'd',
      position: 'pos',
      top: 'top',
      right: 'right',
      bottom: 'bottom',
      left: 'left',
      zIndex: 'z',
      gap: 'gap',
      rowGap: 'rowGap',
      columnGap: 'colGap',
    };

    const shortProp = propMap[prop] || prop;

    // Handle special characters in values
    const sanitizedValue = value
      .replace(/\./g, '') // Remove dots (e.g., "space.4" -> "space4")
      .replace(/\//g, '-') // Replace slashes with dashes
      .replace(/[^a-zA-Z0-9-_]/g, ''); // Remove other special chars

    return `animus-${shortProp}-${sanitizedValue}`;
  }

  private generateNamespacedAtomicClassName(
    prop: string,
    value: string,
    componentDef: ComponentDefinition
  ): string {
    const componentName = this.getComponentName(componentDef);
    const hash = this.generateHash('component', componentDef.id).substring(
      0,
      3
    );

    // Handle special characters in values (same as generateAtomicClassName)
    const sanitizedValue = value
      .replace(/\./g, '') // Remove dots (e.g., "space.4" -> "space4")
      .replace(/\//g, '-') // Replace slashes with dashes
      .replace(/[^a-zA-Z0-9-_]/g, ''); // Remove other special chars

    return `animus-${componentName}-${hash}-${prop}-${sanitizedValue}`;
  }

  private identifyDynamicProperties(
    usages: readonly ComponentUsage[],
    _definition: ComponentDefinition,
    context: ExtractionContext
  ): DynamicProperty[] {
    const dynamics: DynamicProperty[] = [];
    const propRegistry = context.propRegistry;

    if (!propRegistry) {
      return dynamics;
    }

    for (const usage of usages) {
      usage.props.properties.forEach((propValue, name) => {
        // Check if this is a style prop using PropRegistry
        const propConfig = propRegistry.props.get(name);
        if (propConfig && propValue.confidence === Confidence.DYNAMIC) {
          dynamics.push({
            property: name,
            sources: [usage.id],
            reason: 'Dynamic value',
          });
        }
      });
    }

    return dynamics;
  }

  private calculateConfidence(
    atomics: readonly AtomicClass[],
    dynamic: readonly DynamicProperty[]
  ): ConfidenceReport {
    const total = atomics.length + dynamic.length;
    const staticCount = atomics.length;
    const dynamicCount = dynamic.length;

    return {
      overall: total > 0 ? staticCount / total : 1,
      staticProperties: staticCount,
      partialProperties: 0,
      dynamicProperties: dynamicCount,
      coverage: total > 0 ? staticCount / total : 0,
    };
  }

  private generateHash(property: string, value: string | number): string {
    return crypto
      .createHash('sha256')
      .update(`${property}:${value}`)
      .digest('hex')
      .substring(0, 8);
  }

  private toKebabCase(str: string): string {
    // Handle special cases
    if (str === 'backgroundColor') return 'background-color';
    if (str === 'marginLeft') return 'margin-left';
    if (str === 'marginRight') return 'margin-right';
    if (str === 'marginTop') return 'margin-top';
    if (str === 'marginBottom') return 'margin-bottom';
    if (str === 'paddingLeft') return 'padding-left';
    if (str === 'paddingRight') return 'padding-right';
    if (str === 'paddingTop') return 'padding-top';
    if (str === 'paddingBottom') return 'padding-bottom';

    // General conversion
    return str.replace(/[A-Z]/g, (match, offset) =>
      offset > 0 ? `-${match.toLowerCase()}` : match.toLowerCase()
    );
  }

  private isResponsiveValue(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;

    // Check for array syntax: MediaQueryArray<T>
    if (Array.isArray(value)) {
      return value.length > 0;
    }

    // Check for object syntax: MediaQueryMap<T>
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const keys = Object.keys(value);
      // Check if it has breakpoint keys from MediaQueryMap
      const breakpointKeys = ['_', 'xs', 'sm', 'md', 'lg', 'xl'];
      return keys.some((key) => breakpointKeys.includes(key));
    }

    return false;
  }

  private handleResponsiveProp(
    propName: string,
    propValue: PropValue,
    propConfig: PropConfig,
    cssProperty: string,
    componentDef: ComponentDefinition,
    usage: ComponentUsage,
    isCustomProp: boolean,
    atomicMap: Map<string, AtomicClass>,
    conditionalMap: Map<string, ConditionalAtomic>,
    customAtomicMap: Map<string, AtomicClass>,
    customConditionalMap: Map<string, ConditionalAtomic>,
    context: ExtractionContext
  ): void {
    const responsiveValue = propValue.staticValue as any;
    const breakpoints = this.getBreakpointsFromContext(context);

    if (Array.isArray(responsiveValue)) {
      // Array syntax: map to breakpoints by index
      responsiveValue.forEach((value, index) => {
        if (value === null || value === undefined) return;

        const breakpoint = this.getBreakpointByIndex(index, breakpoints);
        this.addConditionalAtomic(
          propName,
          value,
          propConfig,
          cssProperty,
          componentDef,
          usage,
          isCustomProp,
          breakpoint,
          conditionalMap,
          customConditionalMap,
          context
        );
      });
    } else if (typeof responsiveValue === 'object') {
      // Object syntax: use explicit breakpoint keys
      Object.entries(responsiveValue).forEach(([breakpoint, value]) => {
        if (value === null || value === undefined) return;

        this.addConditionalAtomic(
          propName,
          value,
          propConfig,
          cssProperty,
          componentDef,
          usage,
          isCustomProp,
          breakpoint,
          conditionalMap,
          customConditionalMap,
          context
        );
      });
    }
  }

  private addConditionalAtomic(
    propName: string,
    value: unknown,
    propConfig: PropConfig,
    cssProperty: string,
    componentDef: ComponentDefinition,
    usage: ComponentUsage,
    isCustomProp: boolean,
    breakpoint: string,
    conditionalMap: Map<string, ConditionalAtomic>,
    customConditionalMap: Map<string, ConditionalAtomic>,
    context: ExtractionContext
  ): void {
    // Resolve the value
    const resolutionContext: ResolutionContext = {
      theme: context.theme,
      propRegistry: context.propRegistry,
      componentId: componentDef.id,
      logger: context.logger.child('resolver'),
    };

    const resolved = this.valueResolver.resolve(
      value,
      propConfig,
      resolutionContext
    );
    if (resolved.confidence === Confidence.DYNAMIC) return;

    const resolvedValue = String(resolved.value);

    // Generate class name with breakpoint suffix
    const baseClassName = isCustomProp
      ? this.generateNamespacedAtomicClassName(
          propName,
          resolvedValue,
          componentDef
        )
      : this.generateAtomicClassName(propName, resolvedValue);

    // For responsive values, we append the breakpoint to the class name
    const className =
      breakpoint === '_' || breakpoint === 'base'
        ? baseClassName
        : `${baseClassName}-${breakpoint}`;

    const kebabProperty = this.toKebabCase(cssProperty);

    const condition: AtomicCondition = {
      type: 'media',
      query: this.getMediaQuery(breakpoint, context),
    };

    const conditionalAtomic: ConditionalAtomic = {
      className,
      property: kebabProperty,
      value: resolvedValue,
      sources: [usage.id],
      condition,
    };

    // Determine which map to use
    const targetMap = isCustomProp ? customConditionalMap : conditionalMap;
    const key = `${cssProperty}:${resolvedValue}:${breakpoint}${isCustomProp ? `:${componentDef.id}` : ''}`;

    const existing = targetMap.get(key);
    if (existing) {
      targetMap.set(key, {
        ...existing,
        sources: [...existing.sources, ...conditionalAtomic.sources],
      });
    } else {
      targetMap.set(key, conditionalAtomic);
    }
  }

  private getBreakpointsFromContext(context: ExtractionContext): string[] {
    // MediaQueryArray maps to breakpoints: [_, xs, sm, md, lg, xl]
    return ['_', 'xs', 'sm', 'md', 'lg', 'xl'];
  }

  private getBreakpointByIndex(index: number, breakpoints: string[]): string {
    // Index 0 = base (_), 1 = xs, 2 = sm, etc.
    return breakpoints[index] || breakpoints[breakpoints.length - 1];
  }

  private getMediaQuery(
    breakpoint: string,
    _context: ExtractionContext
  ): string {
    // Base case - no media query
    if (breakpoint === '_' || breakpoint === 'base') return 'all';

    // These values will come from theme.breakpoints which is always defined
    // For now, use typical breakpoint values
    const defaultBreakpoints: Record<string, string> = {
      xs: '480px',
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
    };

    const minWidth = defaultBreakpoints[breakpoint];
    if (!minWidth) return 'all';

    return `(min-width: ${minWidth})`;
  }

  private sortAtomicClasses(
    atomics: AtomicClass[],
    propRegistry: PropRegistry | null
  ): AtomicClass[] {
    if (!propRegistry) {
      return atomics;
    }

    // Create a map of prop names to their configs for ordering
    // Convert PropConfig to Prop-compatible format
    const propConfigMap: Record<string, Prop> = {};
    propRegistry.props.forEach((config, name) => {
      propConfigMap[name] = {
        property: config.property as any,
        properties: config.properties as any,
        scale: config.scale as any,
        transform: config.transform as any,
      };
    });

    // Get ordered prop names
    const orderedPropNames = orderPropNames(propConfigMap);

    // Create a map of atomic classes by their source prop name
    const atomicsByProp = new Map<string, AtomicClass[]>();

    atomics.forEach((atomic) => {
      // Find which prop this atomic came from by checking the className
      const propName = this.extractPropFromClassName(atomic.className);
      if (propName) {
        const existing = atomicsByProp.get(propName) || [];
        existing.push(atomic);
        atomicsByProp.set(propName, existing);
      }
    });

    // Build sorted result
    const sorted: AtomicClass[] = [];
    orderedPropNames.forEach((propName) => {
      const atomicsForProp = atomicsByProp.get(propName);
      if (atomicsForProp) {
        sorted.push(...atomicsForProp);
      }
    });

    // Add any atomics that didn't match (shouldn't happen)
    atomics.forEach((atomic) => {
      if (!sorted.includes(atomic)) {
        sorted.push(atomic);
      }
    });

    return sorted;
  }

  private extractPropFromClassName(className: string): string | null {
    // Extract prop name from className like "animus-p-2" -> "p"
    const match = className.match(/^animus-([a-zA-Z]+)-/);
    return match ? match[1] : null;
  }

  private getEffectiveRegistry(
    componentDef: ComponentDefinition,
    globalRegistry: PropRegistry | null
  ): PropRegistry | null {
    // If component has custom props, merge them with global registry
    if (componentDef.customProps) {
      if (!globalRegistry) {
        // Use only custom props
        return {
          props: componentDef.customProps.props,
          groups: componentDef.customProps.groups,
          source: { kind: 'custom', description: 'Component-level props()' },
        };
      }

      // Merge custom props with global registry (custom takes precedence)
      const mergedProps = new Map(globalRegistry.props);
      componentDef.customProps.props.forEach((config, name) => {
        mergedProps.set(name, config);
      });

      return {
        props: mergedProps,
        groups: globalRegistry.groups, // TODO: Merge groups too
        source: { kind: 'custom', description: 'Merged component + global' },
      };
    }

    // No custom props, use global registry
    return globalRegistry;
  }
}

// ============================================================================
// Style Value Resolution
// ============================================================================

interface StyleValueResolver {
  resolve(
    value: unknown,
    propConfig: PropConfig,
    context: ResolutionContext
  ): ResolvedValue;
}

interface ResolutionContext {
  readonly theme?: Record<string, unknown>;
  readonly propRegistry: PropRegistry | null;
  readonly componentId: string;
  readonly logger: Logger;
}

interface ResolvedValue {
  readonly value: string | number;
  readonly isThemeValue: boolean;
  readonly isTransformed: boolean;
  readonly originalValue: unknown;
  readonly confidence: Confidence;
}

class StyleValueResolverImpl implements StyleValueResolver {
  resolve(
    value: unknown,
    propConfig: PropConfig,
    context: ResolutionContext
  ): ResolvedValue {
    // Start with the original value
    let resolvedValue: string | number = String(value);
    let isThemeValue = false;
    let isTransformed = false;
    let confidence = Confidence.STATIC;

    // Step 1: Check if value is a theme token (e.g., "colors.primary", "space.4")
    if (typeof value === 'string' && value.includes('.')) {
      const themeValue = this.resolveThemeToken(value, propConfig, context);
      if (themeValue !== null) {
        resolvedValue = themeValue;
        isThemeValue = true;
        context.logger.debug('Resolved theme token', {
          token: value,
          resolved: resolvedValue,
          scale: propConfig.scale,
        });
      }
    }

    // Step 2: Apply scale if defined and not already a theme value
    if (!isThemeValue && propConfig.scale && context.theme) {
      const scaleValue = this.resolveScale(
        resolvedValue,
        propConfig.scale,
        context
      );
      if (scaleValue !== null) {
        resolvedValue = scaleValue;
        isThemeValue = true;
        context.logger.debug('Resolved scale value', {
          scale: propConfig.scale,
          key: value,
          resolved: resolvedValue,
        });
      }
    }

    // Step 3: Apply transform if defined
    if (propConfig.transform) {
      const transformedValue = this.applyTransform(
        resolvedValue,
        propConfig.transform,
        context
      );
      if (transformedValue !== null) {
        resolvedValue = transformedValue;
        isTransformed = true;
        context.logger.debug('Applied transform', {
          transform: propConfig.transform,
          input: value,
          output: resolvedValue,
        });
      }
    }

    // Step 4: Validate the resolved value
    if (
      typeof resolvedValue !== 'string' &&
      typeof resolvedValue !== 'number'
    ) {
      context.logger.warn('Failed to resolve value to string or number', {
        value,
        propConfig,
        resolved: resolvedValue,
      });
      confidence = Confidence.DYNAMIC;
    }

    return {
      value: resolvedValue,
      isThemeValue,
      isTransformed,
      originalValue: value,
      confidence,
    };
  }

  private resolveThemeToken(
    token: string,
    propConfig: PropConfig,
    context: ResolutionContext
  ): string | null {
    if (!context.theme) return null;

    // Handle dot notation (e.g., "colors.primary.500")
    const parts = token.split('.');
    let current: any = context.theme;

    // If there's a scale, try using it as the first part
    if (propConfig.scale && !context.theme[parts[0]]) {
      current = current[propConfig.scale];
      if (!current) return null;
    }

    // Traverse the theme object
    for (const part of parts) {
      if (current && typeof current === 'object' && part in current) {
        current = current[part];
      } else if (propConfig.scale && parts[0] !== propConfig.scale) {
        // Try with scale prefix if not already tried
        const scaleValue = this.resolveThemeToken(
          `${propConfig.scale}.${token}`,
          propConfig,
          context
        );
        if (scaleValue !== null) return scaleValue;
        return null;
      } else {
        return null;
      }
    }

    return typeof current === 'string' || typeof current === 'number'
      ? String(current)
      : null;
  }

  private resolveScale(
    value: string | number,
    scale: string,
    context: ResolutionContext
  ): string | null {
    if (!context.theme || !scale) return null;

    const scaleObject = context.theme[scale];
    if (!scaleObject || typeof scaleObject !== 'object') return null;

    // Try direct lookup
    const scaleValue = (scaleObject as any)[value];
    if (scaleValue !== undefined) {
      return String(scaleValue);
    }

    // For numeric values, try as string key
    if (typeof value === 'number') {
      const stringKey = String(value);
      const stringValue = (scaleObject as any)[stringKey];
      if (stringValue !== undefined) {
        return String(stringValue);
      }
    }

    return null;
  }

  private applyTransform(
    value: string | number,
    transform: string,
    context: ResolutionContext
  ): string | null {
    // TODO: Implement transform functions
    // For now, we'll just return null to indicate no transformation
    // In the future, this will handle transforms like:
    // - size: px, rem, %, viewport units
    // - borderShorthand: expanding border values
    // - gridItem: grid template values
    // - Custom transforms

    context.logger.debug('Transform not yet implemented', { transform, value });
    return null;
  }
}

// ============================================================================
// PropRegistry Extraction Implementation
// ============================================================================

function extractPropRegistry(
  sourceFile: ts.SourceFile,
  program: ts.Program,
  typeChecker: ts.TypeChecker,
  logger: Logger
): PropRegistry {
  // Try to find any animus import
  const animusImport = findAnimusImport(sourceFile);

  if (animusImport) {
    logger.debug('Found animus import, attempting to extract configuration');

    // Try to extract the actual animus configuration
    const extractedRegistry = extractAnimusConfig(
      animusImport,
      sourceFile,
      program,
      typeChecker,
      logger
    );

    if (extractedRegistry) {
      logger.info('Successfully extracted custom Animus configuration');
      return extractedRegistry;
    }
  }

  logger.info('Using default Animus PropRegistry');
  return getDefaultPropRegistry();
}

function findAnimusImport(
  sourceFile: ts.SourceFile
): ts.ImportDeclaration | null {
  let result: ts.ImportDeclaration | null = null;

  ts.forEachChild(sourceFile, (node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const moduleName = node.moduleSpecifier.text;
      if (moduleName === '@animus-ui/core' || moduleName.includes('animus')) {
        result = node;
      }
    }
  });

  return result;
}

function extractAnimusConfig(
  importDecl: ts.ImportDeclaration,
  sourceFile: ts.SourceFile,
  program: ts.Program,
  typeChecker: ts.TypeChecker,
  logger: Logger
): PropRegistry | null {
  // Check if this is importing a custom animus instance
  const importClause = importDecl.importClause;
  if (!importClause) return null;

  // Handle named imports like: import { animus } from './theme'
  if (
    importClause.namedBindings &&
    ts.isNamedImports(importClause.namedBindings)
  ) {
    for (const element of importClause.namedBindings.elements) {
      const name = element.name.text;
      const propertyName = element.propertyName?.text;

      if (name === 'animus' || propertyName === 'animus') {
        logger.debug('Found named animus import, attempting to resolve');

        // Try to resolve the import to its source
        const symbol = typeChecker.getSymbolAtLocation(element.name);
        if (symbol) {
          return extractRegistryFromSymbol(symbol, typeChecker, logger);
        }
      }
    }
  }

  // Handle default imports like: import animus from './theme'
  if (importClause.name) {
    const symbol = typeChecker.getSymbolAtLocation(importClause.name);
    if (symbol) {
      logger.debug("Found default import, checking if it's an animus instance");
      return extractRegistryFromSymbol(symbol, typeChecker, logger);
    }
  }

  return null;
}

function extractRegistryFromSymbol(
  symbol: ts.Symbol,
  typeChecker: ts.TypeChecker,
  logger: Logger
): PropRegistry | null {
  // Try to find the value declaration
  const declarations = symbol.getDeclarations();
  if (!declarations || declarations.length === 0) return null;

  // Look for createAnimus() or animus.extend() calls
  for (const decl of declarations) {
    if (ts.isVariableDeclaration(decl) && decl.initializer) {
      const registryConfig = extractRegistryFromExpression(
        decl.initializer,
        typeChecker,
        logger
      );
      if (registryConfig) {
        return registryConfig;
      }
    }
  }

  // If we can't extract it, fall back to default
  return null;
}

function extractRegistryFromExpression(
  expr: ts.Expression,
  typeChecker: ts.TypeChecker,
  logger: Logger
): PropRegistry | null {
  // Handle createAnimus({ ... })
  if (ts.isCallExpression(expr)) {
    const funcName = expr.expression.getText();

    if (funcName === 'createAnimus' || funcName.endsWith('.extend')) {
      logger.debug(`Found ${funcName} call, extracting configuration`);

      // For now, we'll return default registry
      // In a full implementation, we would parse the config object
      return getDefaultPropRegistry();
    }
  }

  return null;
}

function getDefaultPropRegistry(): PropRegistry {
  const props = new Map<string, PropConfig>();

  // Space props
  props.set('m', { name: 'm', property: 'margin', scale: 'space' });
  props.set('mx', {
    name: 'mx',
    property: 'margin',
    properties: ['marginLeft', 'marginRight'],
    scale: 'space',
  });
  props.set('my', {
    name: 'my',
    property: 'margin',
    properties: ['marginTop', 'marginBottom'],
    scale: 'space',
  });
  props.set('mt', { name: 'mt', property: 'marginTop', scale: 'space' });
  props.set('mb', { name: 'mb', property: 'marginBottom', scale: 'space' });
  props.set('ml', { name: 'ml', property: 'marginLeft', scale: 'space' });
  props.set('mr', { name: 'mr', property: 'marginRight', scale: 'space' });

  props.set('p', { name: 'p', property: 'padding', scale: 'space' });
  props.set('px', {
    name: 'px',
    property: 'padding',
    properties: ['paddingLeft', 'paddingRight'],
    scale: 'space',
  });
  props.set('py', {
    name: 'py',
    property: 'padding',
    properties: ['paddingTop', 'paddingBottom'],
    scale: 'space',
  });
  props.set('pt', { name: 'pt', property: 'paddingTop', scale: 'space' });
  props.set('pb', { name: 'pb', property: 'paddingBottom', scale: 'space' });
  props.set('pl', { name: 'pl', property: 'paddingLeft', scale: 'space' });
  props.set('pr', { name: 'pr', property: 'paddingRight', scale: 'space' });

  // Color props
  props.set('color', { name: 'color', property: 'color', scale: 'colors' });
  props.set('bg', { name: 'bg', property: 'backgroundColor', scale: 'colors' });
  props.set('backgroundColor', {
    name: 'backgroundColor',
    property: 'backgroundColor',
    scale: 'colors',
  });
  props.set('borderColor', {
    name: 'borderColor',
    property: 'borderColor',
    scale: 'colors',
  });

  // Layout props
  props.set('display', { name: 'display', property: 'display' });
  props.set('width', { name: 'width', property: 'width', transform: 'size' });
  props.set('height', {
    name: 'height',
    property: 'height',
    transform: 'size',
  });
  props.set('size', {
    name: 'size',
    property: 'width',
    properties: ['width', 'height'],
    transform: 'size',
  });
  props.set('minWidth', {
    name: 'minWidth',
    property: 'minWidth',
    transform: 'size',
  });
  props.set('minHeight', {
    name: 'minHeight',
    property: 'minHeight',
    transform: 'size',
  });
  props.set('maxWidth', {
    name: 'maxWidth',
    property: 'maxWidth',
    transform: 'size',
  });
  props.set('maxHeight', {
    name: 'maxHeight',
    property: 'maxHeight',
    transform: 'size',
  });

  // Border props
  props.set('border', {
    name: 'border',
    property: 'border',
    scale: 'borders',
    transform: 'borderShorthand',
  });
  props.set('borderRadius', {
    name: 'borderRadius',
    property: 'borderRadius',
    scale: 'radii',
    transform: 'size',
  });
  props.set('borderWidth', {
    name: 'borderWidth',
    property: 'borderWidth',
    scale: 'borderWidths',
  });
  props.set('borderStyle', { name: 'borderStyle', property: 'borderStyle' });

  // Typography props
  props.set('fontFamily', {
    name: 'fontFamily',
    property: 'fontFamily',
    scale: 'fonts',
  });
  props.set('fontSize', {
    name: 'fontSize',
    property: 'fontSize',
    scale: 'fontSizes',
  });
  props.set('fontWeight', {
    name: 'fontWeight',
    property: 'fontWeight',
    scale: 'fontWeights',
  });
  props.set('lineHeight', {
    name: 'lineHeight',
    property: 'lineHeight',
    scale: 'lineHeights',
  });
  props.set('letterSpacing', {
    name: 'letterSpacing',
    property: 'letterSpacing',
    scale: 'letterSpacings',
  });
  props.set('textAlign', { name: 'textAlign', property: 'textAlign' });

  // Flexbox props
  props.set('flexDirection', {
    name: 'flexDirection',
    property: 'flexDirection',
  });
  props.set('flexWrap', { name: 'flexWrap', property: 'flexWrap' });
  props.set('flexBasis', { name: 'flexBasis', property: 'flexBasis' });
  props.set('flexGrow', { name: 'flexGrow', property: 'flexGrow' });
  props.set('flexShrink', { name: 'flexShrink', property: 'flexShrink' });
  props.set('alignItems', { name: 'alignItems', property: 'alignItems' });
  props.set('alignContent', { name: 'alignContent', property: 'alignContent' });
  props.set('justifyContent', {
    name: 'justifyContent',
    property: 'justifyContent',
  });
  props.set('justifyItems', { name: 'justifyItems', property: 'justifyItems' });
  props.set('gap', { name: 'gap', property: 'gap', scale: 'space' });

  // Position props
  props.set('position', { name: 'position', property: 'position' });
  props.set('top', { name: 'top', property: 'top', scale: 'space' });
  props.set('right', { name: 'right', property: 'right', scale: 'space' });
  props.set('bottom', { name: 'bottom', property: 'bottom', scale: 'space' });
  props.set('left', { name: 'left', property: 'left', scale: 'space' });
  props.set('zIndex', {
    name: 'zIndex',
    property: 'zIndex',
    scale: 'zIndices',
  });

  // Other common props
  props.set('opacity', { name: 'opacity', property: 'opacity' });
  props.set('overflow', { name: 'overflow', property: 'overflow' });
  props.set('overflowX', { name: 'overflowX', property: 'overflowX' });
  props.set('overflowY', { name: 'overflowY', property: 'overflowY' });

  const groups = new Map([
    [
      'space',
      [
        'm',
        'mx',
        'my',
        'mt',
        'mb',
        'ml',
        'mr',
        'p',
        'px',
        'py',
        'pt',
        'pb',
        'pl',
        'pr',
        'gap',
        'top',
        'right',
        'bottom',
        'left',
      ],
    ],
    ['color', ['color', 'bg', 'backgroundColor', 'borderColor']],
    [
      'layout',
      [
        'display',
        'width',
        'height',
        'size',
        'minWidth',
        'minHeight',
        'maxWidth',
        'maxHeight',
      ],
    ],
    [
      'border',
      ['border', 'borderRadius', 'borderWidth', 'borderStyle', 'borderColor'],
    ],
    [
      'typography',
      [
        'fontFamily',
        'fontSize',
        'fontWeight',
        'lineHeight',
        'letterSpacing',
        'textAlign',
      ],
    ],
    [
      'flexbox',
      [
        'flexDirection',
        'flexWrap',
        'flexBasis',
        'flexGrow',
        'flexShrink',
        'alignItems',
        'alignContent',
        'justifyContent',
        'justifyItems',
      ],
    ],
    ['position', ['position', 'top', 'right', 'bottom', 'left', 'zIndex']],
  ]);

  return {
    props,
    groups,
    source: { kind: 'default' },
  };
}

// ============================================================================
// Main Orchestrator Implementation
// ============================================================================

interface StaticExtractor {
  readonly config: ExtractorConfig;
  extractFile(fileName: string): FileExtractionResult;
  extractProject(): ProjectExtractionResult;
  updateFile(fileName: string, changes: FileChange[]): UpdateResult;
}

interface FileExtractionResult {
  readonly fileName: string;
  readonly components: readonly ExtractionResult[];
  readonly errors: readonly ExtractionError[];
  readonly performance: PerformanceReport;
}

interface ProjectExtractionResult {
  readonly files: ReadonlyMap<string, FileExtractionResult>;
  readonly crossFileGraph: DependencyGraph;
  readonly aggregateStats: AggregateStats;
}

interface UpdateResult {
  readonly affected: readonly string[];
  readonly cascaded: readonly string[];
  readonly results: readonly ExtractionResult[];
}

interface FileChange {
  readonly type: 'add' | 'modify' | 'delete';
  readonly span: ts.TextSpan;
  readonly newText?: string;
}

interface DependencyGraph {
  readonly nodes: ReadonlyMap<string, GraphNode>;
  readonly edges: ReadonlyMap<string, string[]>;
}

interface GraphNode {
  readonly id: string;
  readonly type: 'component' | 'file' | 'module';
  readonly metadata: Record<string, unknown>;
}

interface AggregateStats {
  readonly totalComponents: number;
  readonly totalAtomics: number;
  readonly averageConfidence: number;
  readonly executionTimeMs: number;
}

class StaticExtractionOrchestrator implements StaticExtractor {
  readonly config: ExtractorConfig;
  private readonly cache: CacheManager;
  private readonly monitor: PerformanceMonitor;
  private readonly errorHandler: ErrorHandler;
  private readonly logger: Logger;
  private readonly diagnostics: DiagnosticsCollector;

  // Phase implementations
  private readonly discovery: TerminalDiscoveryPhase;
  private readonly reconstruction: ChainReconstructionPhase;
  private readonly collection: UsageCollectionPhase;
  private readonly computation: AtomicComputationPhase;

  constructor(config: ExtractorConfig) {
    this.config = config;

    // Initialize infrastructure
    this.cache = new MemoryCacheManager(config.cacheStrategy);
    this.monitor = new PerformanceMonitorImpl(config.monitoring);
    this.errorHandler = new ErrorHandlerImpl(config.errorStrategy);
    this.logger = new ConsoleLogger('StaticExtractor');
    this.diagnostics = new SimpleDiagnosticsCollector();

    // Initialize phases
    this.discovery = new TerminalDiscoveryAlgorithm();
    this.reconstruction = new ChainReconstructionAlgorithm();
    this.collection = new UsageCollectionAlgorithm();
    this.computation = new AtomicComputationAlgorithm();
  }

  extractFile(fileName: string): FileExtractionResult {
    const timer = this.monitor.startPhase('file-extraction');

    try {
      // Create TypeScript program for the file
      const { program, sourceFile, typeChecker } = this.createProgram(fileName);

      // Extract PropRegistry once at the start
      const propRegistry = extractPropRegistry(
        sourceFile,
        program,
        typeChecker,
        this.logger
      );

      // Create extraction context
      const context: ExtractionContext = {
        typeChecker,
        program,
        languageService: ts.createLanguageService({
          getScriptFileNames: () => [fileName],
          getScriptVersion: () => '0',
          getScriptSnapshot: (name) => {
            const file = program.getSourceFile(name);
            return file ? ts.ScriptSnapshot.fromString(file.text) : undefined;
          },
          getCurrentDirectory: () => process.cwd(),
          getCompilationSettings: () => ({}),
          getDefaultLibFileName: ts.getDefaultLibFilePath,
          fileExists: ts.sys.fileExists,
          readFile: ts.sys.readFile,
          readDirectory: ts.sys.readDirectory,
          directoryExists: ts.sys.directoryExists,
          getDirectories: ts.sys.getDirectories,
        }),
        sourceFile,
        currentPhase: 'discovery',
        symbolTable: new Map(),
        componentRegistry: new Map(),
        usageRegistry: new Map(),
        config: this.config,
        propRegistry,
        monitor: this.monitor,
        errorHandler: this.errorHandler,
        cache: this.cache,
        logger: this.logger,
        diagnostics: this.diagnostics,
        getPhaseLogger: (phase: string) => this.logger.child(phase),
      };

      // Phase 1: Terminal Discovery
      this.logger.info('Starting Phase 1: Terminal Discovery');
      this.diagnostics.recordPhaseStart('discovery');

      const terminals = this.runPhase(
        'discovery',
        () => this.discovery.execute(context, {}),
        context
      );

      this.diagnostics.recordPhaseEnd('discovery');
      this.diagnostics.recordMetric(
        'terminals.found',
        terminals.terminals.length
      );
      this.logger.debug(`Found ${terminals.terminals.length} terminals`);

      // Phase 2-4: Process each terminal
      const componentResults = this.processTerminals(
        terminals.terminals,
        context
      );

      timer.end();

      // Generate diagnostics report if monitoring is enabled
      if (this.config.monitoring) {
        const report = this.diagnostics.generateReport();
        this.logger.info('Extraction complete', {
          totalTime: report.summary.totalTime,
          componentsFound: report.summary.componentsFound,
          atomicsGenerated: report.summary.atomicsGenerated,
          errors: report.summary.totalErrors,
        });
      }

      return {
        fileName,
        components: componentResults,
        errors: this.errorHandler.summarize().fatalErrors,
        performance: this.monitor.getReport(),
      };
    } catch (error) {
      timer.end();
      this.logger.error('Extraction failed', error);
      throw this.wrapError(error);
    }
  }

  extractProject(): ProjectExtractionResult {
    // TODO: Implement project-wide extraction
    throw new Error('Not implemented');
  }

  updateFile(_fileName: string, _changes: FileChange[]): UpdateResult {
    // TODO: Implement incremental updates
    throw new Error('Not implemented');
  }

  private createProgram(fileName: string): {
    program: ts.Program;
    sourceFile: ts.SourceFile;
    typeChecker: ts.TypeChecker;
  } {
    const compilerOptions: ts.CompilerOptions = {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.React,
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
    };

    const program = ts.createProgram([fileName], compilerOptions);
    const sourceFile = program.getSourceFile(fileName);

    if (!sourceFile) {
      throw new Error(`Could not load source file: ${fileName}`);
    }

    return {
      program,
      sourceFile,
      typeChecker: program.getTypeChecker(),
    };
  }

  private runPhase<T>(
    phaseName: ExtractionPhase,
    execute: () => T,
    context: ExtractionContext
  ): T {
    const timer = this.monitor.startPhase(phaseName);

    try {
      (context as any).currentPhase = phaseName;
      const result = execute();
      timer.end();
      return result;
    } catch (error) {
      timer.end();
      throw error;
    }
  }

  private processTerminals(
    terminals: readonly TerminalNode[],
    context: ExtractionContext
  ): ExtractionResult[] {
    const results: ExtractionResult[] = [];

    for (const terminal of terminals) {
      const result = this.processTerminal(terminal, context);
      if (result) {
        results.push(result);
      }
    }

    return results;
  }

  private processTerminal(
    terminal: TerminalNode,
    context: ExtractionContext
  ): ExtractionResult | null {
    const logger = this.logger.child(
      `Component:${terminal.componentId.substring(0, 8)}`
    );

    try {
      logger.debug('Processing terminal', { type: terminal.type });

      // Check cache first
      const cacheKey: CacheKey = {
        type: 'component',
        id: terminal.componentId,
        version: this.getFileVersion(context.sourceFile),
      };

      const cached = this.cache.get<ExtractionResult>(cacheKey);
      if (cached) {
        logger.debug('Cache hit');
        this.diagnostics.recordMetric('cache.hits', 1);
        return cached;
      }

      this.diagnostics.recordMetric('cache.misses', 1);

      // Phase 2: Chain Reconstruction
      logger.debug('Starting chain reconstruction');
      this.diagnostics.recordPhaseStart('reconstruction');
      const definition = this.runPhase(
        'reconstruction',
        () => this.reconstruction.execute(context, { terminal }),
        context
      );

      this.diagnostics.recordPhaseEnd('reconstruction');
      logger.debug('Chain reconstruction complete', {
        chainLength: definition.definition.chain.length,
        hasVariableBinding: !!definition.definition.variableBinding,
      });

      // Register component
      context.componentRegistry.set(
        terminal.componentId,
        definition.definition
      );

      // Phase 3: Usage Collection
      logger.debug('Starting usage collection');
      this.diagnostics.recordPhaseStart('collection');
      const usages = this.runPhase(
        'collection',
        () =>
          this.collection.execute(context, {
            definition: definition.definition,
          }),
        context
      );

      this.diagnostics.recordPhaseEnd('collection');
      logger.debug('Usage collection complete', {
        usageCount: usages.usages.length,
        crossFileRefs: usages.crossFileRefs.length,
      });

      // Register usages
      context.usageRegistry.set(terminal.componentId, [...usages.usages]);

      // Phase 4: Atomic Computation
      logger.debug('Starting atomic computation');
      this.diagnostics.recordPhaseStart('computation');

      const result = this.runPhase(
        'computation',
        () =>
          this.computation.execute(context, {
            definition: definition.definition,
            usages: usages.usages,
          }),
        context
      );

      this.diagnostics.recordPhaseEnd('computation');
      logger.debug('Atomic computation complete', {
        requiredAtomics: result.result.atomicClasses.required.length,
        conditionalAtomics: result.result.atomicClasses.conditional.length,
        customRequiredAtomics:
          result.result.atomicClasses.customRequired.length,
        customConditionalAtomics:
          result.result.atomicClasses.customConditional.length,
        dynamicProperties: result.result.dynamicProperties.length,
        confidence: result.result.confidence.overall,
      });

      this.diagnostics.recordMetric('components.found', 1);
      const totalAtomics =
        result.result.atomicClasses.required.length +
        result.result.atomicClasses.customRequired.length;
      this.diagnostics.recordMetric('atomics.generated', totalAtomics);

      // Cache result
      this.cache.set(cacheKey, result.result);

      const totalAtomicsGenerated =
        result.result.atomicClasses.required.length +
        result.result.atomicClasses.customRequired.length;
      logger.info('Component processing complete', {
        componentId: terminal.componentId,
        atomicsGenerated: totalAtomicsGenerated,
      });

      return result.result;
    } catch (error) {
      logger.error('Failed to process terminal', error);
      this.errorHandler.report({
        phase: 'computation',
        severity: 'error',
        code: 'TERMINAL_PROCESSING_ERROR',
        message: `Failed to process terminal ${terminal.id}: ${error}`,
        node: terminal.node,
      });

      return null;
    }
  }

  private getFileVersion(sourceFile: ts.SourceFile): string {
    return crypto
      .createHash('sha256')
      .update(sourceFile.text)
      .digest('hex')
      .substring(0, 16);
  }

  private wrapError(error: unknown): Error {
    if (error instanceof Error) return error;
    return new Error(String(error));
  }
}

// ============================================================================
// Export Configuration
// ============================================================================

export function createDefaultConfig(): ExtractorConfig {
  return {
    phases: {
      discovery: {
        terminalMethods: ['asElement', 'asComponent', 'build'],
        maxDepth: 100,
        followImports: false,
      },
      reconstruction: {
        maxChainLength: 50,
        allowedMethods: ['styles', 'variant', 'states', 'extend'],
        typeResolution: 'shallow',
      },
      collection: {
        searchScope: 'file',
        maxSpreadDepth: 3,
        followDynamicImports: false,
      },
      computation: {
        mergeStrategy: 'smart',
        hashAlgorithm: 'sha256',
        includeUnused: false,
      },
    },
    errorStrategy: 'continue',
    cacheStrategy: 'memory',
    parallelism: 4,
    monitoring: true,
  };
}

// ============================================================================
// Main Export
// ============================================================================

export function createStaticExtractor(
  config?: Partial<ExtractorConfig>
): StaticExtractor {
  const fullConfig = {
    ...createDefaultConfig(),
    ...config,
  };

  return new StaticExtractionOrchestrator(fullConfig);
}

export * from './index';
