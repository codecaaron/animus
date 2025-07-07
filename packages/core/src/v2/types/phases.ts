/**
 * Phase-related types for Animus static extraction
 *
 * This module contains interfaces for the extraction phases and their contracts.
 * The extraction process is divided into four phases: Discovery, Reconstruction,
 * Collection, and Computation.
 */

import type * as ts from 'typescript';

import type {
  ComponentDefinition,
  ComponentUsage,
  CrossFileReference,
  ExtractionPhase,
  ExtractionResult,
  SourcePosition,
  TerminalNode,
} from './core';
import type { ExtractionContext } from './extraction';

// ============================================================================
// Unified Phase Interface
// ============================================================================

/**
 * Base interface for all extraction phases
 */
export interface Phase<TInput, TOutput> {
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

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ValidationError[];
  readonly warnings: readonly ValidationWarning[];
}

export interface ValidationError {
  readonly message: string;
  readonly path?: string;
  readonly value?: unknown;
}

export interface ValidationWarning {
  readonly message: string;
  readonly suggestion?: string;
}

// ============================================================================
// Phase 1: Terminal Discovery
// ============================================================================

export interface TerminalDiscoveryPhase
  extends Phase<TerminalDiscoveryInput, TerminalDiscoveryOutput> {
  readonly name: 'discovery';
}

export interface TerminalDiscoveryInput {
  // Empty - everything needed is in context
}

export interface TerminalDiscoveryOutput {
  readonly terminals: readonly TerminalNode[];
  readonly errors: readonly DiscoveryError[];
}

export interface TerminalDiscoveryOptions {
  readonly terminalMethods: readonly string[];
  readonly maxDepth: number;
  readonly followImports: boolean;
}

export interface DiscoveryError {
  readonly kind: 'invalid_terminal' | 'type_error' | 'depth_exceeded';
  readonly node: ts.Node;
  readonly message: string;
}

// ============================================================================
// Phase 2: Chain Reconstruction
// ============================================================================

export interface ChainReconstructionPhase
  extends Phase<ChainReconstructionInput, ChainReconstructionOutput> {
  readonly name: 'reconstruction';
}

export interface ChainReconstructionInput {
  readonly terminal: TerminalNode;
}

export interface ChainReconstructionOutput {
  readonly definition: ComponentDefinition;
  readonly errors: readonly ChainError[];
}

export interface ChainReconstructionOptions {
  readonly maxChainLength: number;
  readonly allowedMethods: readonly string[];
  readonly typeResolution: TypeResolutionStrategy;
}

export type TypeResolutionStrategy = 'full' | 'shallow' | 'none';

export interface ChainError {
  readonly kind: 'invalid_chain' | 'type_mismatch' | 'circular_reference';
  readonly node: ts.Node;
  readonly message: string;
}

// ============================================================================
// Phase 3: Usage Collection
// ============================================================================

export interface UsageCollectionPhase
  extends Phase<UsageCollectionInput, UsageCollectionOutput> {
  readonly name: 'collection';
}

export interface UsageCollectionInput {
  readonly definition: ComponentDefinition;
}

export interface UsageCollectionOutput {
  readonly usages: readonly ComponentUsage[];
  readonly crossFileRefs: readonly CrossFileReference[];
  readonly errors: readonly UsageError[];
}

export interface UsageCollectionOptions {
  readonly searchScope: SearchScope;
  readonly maxSpreadDepth: number;
  readonly followDynamicImports: boolean;
}

export type SearchScope = 'file' | 'project' | 'workspace';

export interface UsageError {
  readonly kind:
    | 'unresolved_reference'
    | 'spread_depth_exceeded'
    | 'type_error';
  readonly location: SourcePosition;
  readonly message: string;
}

// ============================================================================
// Phase 4: Atomic Computation
// ============================================================================

export interface AtomicComputationPhase
  extends Phase<AtomicComputationInput, AtomicComputationOutput> {
  readonly name: 'computation';
}

export interface AtomicComputationInput {
  readonly definition: ComponentDefinition;
  readonly usages: readonly ComponentUsage[];
}

export interface AtomicComputationOutput {
  readonly result: ExtractionResult;
  readonly stats: ComputationStats;
}

export interface AtomicComputationOptions {
  readonly mergeStrategy: MergeStrategy;
  readonly hashAlgorithm: HashAlgorithm;
  readonly includeUnused: boolean;
}

export type MergeStrategy = 'union' | 'intersection' | 'smart';
export type HashAlgorithm = 'xxhash' | 'murmur3' | 'sha256';

export interface ComputationStats {
  readonly totalProperties: number;
  readonly uniqueAtomics: number;
  readonly duplicatesRemoved: number;
  readonly executionTimeMs: number;
}
