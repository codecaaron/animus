/**
 * Core data model types for Animus static extraction
 *
 * This module contains the fundamental types used throughout the extraction system.
 * These types model the AST nodes, component definitions, and extraction results.
 */

import type * as ts from 'typescript';

// ============================================================================
// Core Primitives
// ============================================================================

/**
 * Source position tracking for all AST nodes
 */
export interface SourcePosition {
  readonly fileName: string;
  readonly line: number;
  readonly column: number;
  readonly offset: number;
}

/**
 * Unique identifier for any tracked node
 * Format: "{fileName}:{line}:{column}:{nodeKind}"
 */
export type NodeId = string;

/**
 * Terminal types that end a component chain
 */
export type TerminalType = 'asElement' | 'asComponent' | 'build';

/**
 * Chain methods that can appear in component definition
 */
export type ChainMethod =
  | 'styles'
  | 'variant'
  | 'states'
  | 'groups'
  | 'props'
  | 'extend';

/**
 * Confidence levels for static analysis
 */
export enum Confidence {
  STATIC = 1.0, // Fully analyzable at compile time
  PARTIAL = 0.5, // Partially analyzable (e.g., known keys, unknown values)
  DYNAMIC = 0.0, // Runtime-only determination
}

// ============================================================================
// AST Node Tracking
// ============================================================================

/**
 * Base wrapper for all AST nodes we track
 */
export interface TrackedNode<T extends ts.Node = ts.Node> {
  readonly id: NodeId;
  readonly node: T;
  readonly position: SourcePosition;
  readonly parent?: NodeId;
}

/**
 * Terminal node representing component definition endpoints
 */
export interface TerminalNode extends TrackedNode<ts.CallExpression> {
  readonly type: TerminalType;
  readonly componentId: string; // Unique component identifier
  readonly variableBinding?: NodeId; // Reference to variable declaration
}

/**
 * Chain call representation
 */
export interface ChainCall extends TrackedNode<ts.CallExpression> {
  readonly method: ChainMethod;
  readonly arguments: readonly ArgumentValue[];
  readonly typeArguments: readonly ts.Type[];
  readonly chainPosition: number; // 0-based position in chain
  readonly nextCall?: NodeId; // Next call in chain
  readonly previousCall?: NodeId; // Previous call in chain
}

/**
 * Argument value with type information
 */
export interface ArgumentValue {
  readonly expression: ts.Expression;
  readonly type: ts.Type;
  readonly staticValue?: unknown; // If statically determinable
  readonly confidence: Confidence;
}

// ============================================================================
// Component Definition
// ============================================================================

/**
 * Complete component definition
 */
export interface ComponentDefinition {
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

export interface VariableBinding extends TrackedNode<ts.VariableDeclaration> {
  readonly name: string;
  readonly exportModifier?: 'export' | 'export default';
  readonly scope: ScopeType;
}

export type ScopeType = 'module' | 'function' | 'block';

export interface ComponentTypeSignature {
  readonly props: ts.Type;
  readonly element: ts.Type;
  readonly styleProps: readonly string[];
}

export interface ComponentReference {
  readonly componentId: string;
  readonly importPath?: string; // If from different module
  readonly preservedMethods: readonly ChainMethod[];
}

// ============================================================================
// Style Definitions
// ============================================================================

/**
 * CSS property tracking
 */
export interface CSSProperty {
  readonly name: string;
  readonly value: string | number;
  readonly source: NodeId;
  readonly confidence: Confidence;
}

export interface StyleMap {
  readonly properties: ReadonlyMap<string, CSSProperty>;
  readonly source: NodeId;
}

export interface VariantMap {
  readonly variants: ReadonlyMap<string, VariantDefinition>;
}

export interface VariantDefinition {
  readonly options: ReadonlyMap<string, StyleMap>;
  readonly defaultOption?: string;
  readonly compound?: readonly CompoundVariant[];
}

export interface CompoundVariant {
  readonly conditions: ReadonlyMap<string, string>;
  readonly styles: StyleMap;
}

export interface StateMap {
  readonly states: ReadonlyMap<string, StateDefinition>;
}

export interface StateDefinition {
  readonly selector: string; // e.g., ":hover", ":focus"
  readonly styles: StyleMap;
}

// ============================================================================
// Component Usage
// ============================================================================

/**
 * JSX usage of a component
 */
export interface ComponentUsage
  extends TrackedNode<ts.JsxElement | ts.JsxSelfClosingElement> {
  readonly componentId: string;
  readonly props: PropMap;
  readonly spreads: readonly SpreadAnalysis[];
  readonly children?: readonly ComponentUsage[];
}

export interface PropMap {
  readonly properties: ReadonlyMap<string, PropValue>;
}

export interface PropValue {
  readonly name: string;
  readonly value: ts.Expression;
  readonly staticValue?: unknown;
  readonly type: ts.Type;
  readonly confidence: Confidence;
}

export interface SpreadAnalysis {
  readonly expression: ts.Expression;
  readonly source: SpreadSource;
  readonly confidence: Confidence;
}

export type SpreadSource =
  | { kind: 'identifier'; symbol: ts.Symbol; tracedValue?: PropMap }
  | { kind: 'object'; properties: PropMap }
  | { kind: 'call'; returnType: ts.Type }
  | { kind: 'unknown'; reason: string };

// ============================================================================
// Extraction Results
// ============================================================================

/**
 * Final extraction result with both component and atomic CSS
 */
export interface ExtractionResult {
  readonly componentId: string;
  readonly componentClass: ComponentClass; // Base styles for component
  readonly atomicClasses: AtomicClassSet; // Atomic utilities from JSX props
  readonly dynamicProperties: readonly DynamicProperty[];
  readonly confidence: ConfidenceReport;
}

/**
 * Component CSS class (e.g., .animus-Button-b8d)
 */
export interface ComponentClass {
  readonly className: string; // e.g., "animus-Button-b8d"
  readonly baseStyles: StyleMap; // From .styles()
  readonly variants: ReadonlyMap<string, VariantClass[]>; // From .variant()
  readonly states: ReadonlyMap<string, StateClass>; // From .states()
}

export interface VariantClass {
  readonly className: string; // e.g., "animus-Button-b8d-size-small"
  readonly option: string;
  readonly styles: StyleMap;
}

export interface StateClass {
  readonly className: string; // e.g., "animus-Button-b8d-state-disabled"
  readonly state: string;
  readonly styles: StyleMap;
}

/**
 * Atomic utility classes from JSX props
 */
export interface AtomicClassSet {
  // Global atomic classes that can be shared across components
  readonly required: readonly AtomicClass[]; // Direct props
  readonly conditional: readonly ConditionalAtomic[]; // Responsive/conditional
  readonly potential: readonly AtomicClass[]; // From spreads

  // Component-specific atomic classes (namespaced custom props)
  readonly customRequired: readonly AtomicClass[]; // Direct custom props
  readonly customConditional: readonly ConditionalAtomic[]; // Responsive custom props
  readonly customPotential: readonly AtomicClass[]; // Custom props from spreads
}

export interface AtomicClass {
  readonly className: string; // e.g., "animus-p-4", "animus-bg-red"
  readonly property: string; // CSS property name
  readonly value: string | number; // CSS value
  readonly sources: readonly NodeId[]; // JSX usage locations
}

export interface ConditionalAtomic extends AtomicClass {
  readonly condition: AtomicCondition;
}

export type AtomicCondition =
  | { type: 'variant'; variant: string; option: string }
  | { type: 'state'; state: string }
  | { type: 'media'; query: string }
  | { type: 'compound'; conditions: readonly AtomicCondition[] };

export interface DynamicProperty {
  readonly property: string;
  readonly sources: readonly NodeId[];
  readonly reason: string;
}

export interface ConfidenceReport {
  readonly overall: Confidence;
  readonly staticProperties: number;
  readonly partialProperties: number;
  readonly dynamicProperties: number;
  readonly coverage: number; // 0-1 percentage of analyzable code
}

export type ExtractionPhase =
  | 'discovery'
  | 'reconstruction'
  | 'collection'
  | 'computation';

/**
 * Cross-file reference tracking
 */
export interface CrossFileReference {
  readonly fromFile: string;
  readonly toFile: string;
  readonly componentId: string;
  readonly importStatement: ts.ImportDeclaration;
}

// ============================================================================
// PropRegistry Types (moved from propRegistryExtractor)
// ============================================================================

export interface ExtractedPropRegistry {
  readonly props: Map<string, PropConfig>;
  readonly groups: Map<string, string[]>; // group name -> prop names
  readonly confidence: Confidence;
}

export interface PropConfig {
  readonly name: string;
  readonly property: string; // CSS property name
  readonly properties?: string[]; // Multiple CSS properties
  readonly scale?: string; // Theme scale name
  readonly transform?: string; // Transform function name
}
