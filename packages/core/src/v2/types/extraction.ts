/**
 * Extraction-related types for Animus static extraction
 *
 * This module contains interfaces for the extraction context, configuration,
 * and infrastructure types used throughout the extraction system.
 */

import type * as ts from 'typescript';

import type { DiagnosticsCollector } from '../diagnostics';
import type { ErrorHandler, ErrorStrategy, ExtractionError } from '../errors';
import type { CacheManager, CacheStrategy } from '../infrastructure/cache';
import type { Logger } from '../logger';
import type { PerformanceMonitor, PerformanceReport } from '../performance';
import type { PropRegistry } from '../propRegistryExtractor';
import type {
  ComponentDefinition,
  ComponentUsage,
  ExtractionPhase,
  ExtractionResult,
} from './core';
import type {
  AtomicComputationOptions,
  ChainReconstructionOptions,
  TerminalDiscoveryOptions,
  UsageCollectionOptions,
} from './phases';

// ============================================================================
// Extraction Context
// ============================================================================

/**
 * Central context that flows through all extraction phases
 */
export interface ExtractionContext {
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

export interface SymbolInfo {
  readonly symbol: ts.Symbol;
  readonly declarations: ts.Declaration[];
  readonly type: ts.Type;
  readonly value?: unknown;
}

// ============================================================================
// Configuration
// ============================================================================

export interface ExtractorConfig {
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
// Extraction Interfaces
// ============================================================================

export interface StaticExtractor {
  readonly config: ExtractorConfig;
  extractFile(fileName: string): FileExtractionResult;
  extractProject(): ProjectExtractionResult;
  updateFile(fileName: string, changes: FileChange[]): UpdateResult;
}

export interface FileExtractionResult {
  readonly fileName: string;
  readonly components: readonly ExtractionResult[];
  readonly errors: readonly ExtractionError[];
  readonly performance: PerformanceReport;
}

export interface ProjectExtractionResult {
  readonly files: ReadonlyMap<string, FileExtractionResult>;
  readonly crossFileGraph: DependencyGraph;
  readonly aggregateStats: AggregateStats;
}

export interface UpdateResult {
  readonly affected: readonly string[];
  readonly cascaded: readonly string[];
  readonly results: readonly ExtractionResult[];
}

export interface FileChange {
  readonly type: 'add' | 'modify' | 'delete';
  readonly span: ts.TextSpan;
  readonly newText?: string;
}

export interface DependencyGraph {
  readonly nodes: ReadonlyMap<string, GraphNode>;
  readonly edges: ReadonlyMap<string, string[]>;
}

export interface GraphNode {
  readonly id: string;
  readonly type: 'component' | 'file' | 'module';
  readonly metadata: Record<string, unknown>;
}

export interface AggregateStats {
  readonly totalComponents: number;
  readonly totalAtomics: number;
  readonly averageConfidence: number;
  readonly executionTimeMs: number;
}

// Theme extraction from context or imports
export interface ThemeExtractor {
  extractFromProgram(program: ts.Program): ExtractedTheme | null;
  extractFromType(
    themeType: ts.Type,
    typeChecker: ts.TypeChecker
  ): ExtractedTheme | null;
}

export interface ExtractedTheme {
  readonly scales: Map<string, ThemeScale>;
  readonly source: ThemeSource;
}

export interface ThemeScale {
  readonly name: string;
  readonly values: Map<string | number, unknown>;
  readonly isArray: boolean;
}

export type ThemeSource =
  | { kind: 'context'; providerType: ts.Type }
  | { kind: 'styled'; emotionTheme: ts.Type }
  | { kind: 'import'; importPath: string }
  | { kind: 'inline'; node: ts.Node };
