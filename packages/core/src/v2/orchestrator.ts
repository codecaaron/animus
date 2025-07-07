import * as crypto from 'crypto';

import * as ts from 'typescript';

import type { CacheKey, CacheManager } from './infrastructure/cache';
import { MemoryCacheManager } from './infrastructure/cache';
import type { DiagnosticsCollector } from './infrastructure/diagnostics';
import { SimpleDiagnosticsCollector } from './infrastructure/diagnostics';
import type { ErrorHandler, ExtractionError } from './infrastructure/errors';
import { ErrorHandlerImpl } from './infrastructure/errors';
import type { Logger } from './infrastructure/logger';
import { ConsoleLogger } from './infrastructure/logger';
import type { PerformanceMonitor } from './infrastructure/performance';
import { PerformanceMonitorImpl } from './infrastructure/performance';
import { AtomicComputationAlgorithm } from './phases/atomicComputation';
import { ChainReconstructionAlgorithm } from './phases/chainReconstruction';
import { TerminalDiscoveryAlgorithm } from './phases/terminalDiscovery';
import { UsageCollectionAlgorithm } from './phases/usageCollection';
import type { PropRegistry } from './registry/propRegistryExtractor';
import { getDefaultPropRegistry } from './registry/propRegistryExtractor';
import type {
  AtomicComputationPhase,
  ChainReconstructionPhase,
  ExtractionContext,
  ExtractionPhase,
  ExtractionResult,
  ExtractorConfig,
  FileChange,
  FileExtractionResult,
  ProjectExtractionResult,
  StaticExtractor,
  TerminalDiscoveryPhase,
  TerminalNode,
  UpdateResult,
  UsageCollectionPhase,
} from './types';

export class StaticExtractionOrchestrator implements StaticExtractor {
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
    const animusImport = importClause.namedBindings.elements.find(
      (el) => el.name.text === 'animus'
    );

    if (animusImport) {
      const animusSymbol = typeChecker.getSymbolAtLocation(animusImport.name);
      if (animusSymbol) {
        logger.debug('Found animus symbol, tracing to definition');
        // Try to find where animus is defined
        const declaration = animusSymbol.valueDeclaration;
        if (declaration) {
          const declSourceFile = declaration.getSourceFile();
          const registryExtractor = new TypeBasedPropRegistryExtractor(
            typeChecker,
            logger
          );
          return registryExtractor.extract(animusSymbol, declSourceFile);
        }
      }
    }
  }

  // Handle default import like: import animus from './theme'
  if (importClause.name) {
    const animusSymbol = typeChecker.getSymbolAtLocation(importClause.name);
    if (animusSymbol) {
      // Find the source module and look for createAnimus call
      const moduleSymbol = typeChecker.getSymbolAtLocation(
        importDecl.moduleSpecifier
      );
      if (moduleSymbol) {
        const exports = typeChecker.getExportsOfModule(moduleSymbol);
        const defaultExport = exports.find((e) => e.name === 'default');
        if (defaultExport && defaultExport.valueDeclaration) {
          const sourceFile = defaultExport.valueDeclaration.getSourceFile();
          return extractRegistryFromFile(sourceFile, typeChecker, logger);
        }
      }
    }
  }

  return null;
}

function extractRegistryFromFile(
  sourceFile: ts.SourceFile,
  typeChecker: ts.TypeChecker,
  logger: Logger
): PropRegistry | null {
  let registry: PropRegistry | null = null;

  ts.forEachChild(sourceFile, function visit(node) {
    if (ts.isVariableStatement(node)) {
      node.declarationList.declarations.forEach((decl) => {
        if (
          decl.initializer &&
          ts.isCallExpression(decl.initializer) &&
          decl.name.getText() === 'animus'
        ) {
          registry = extractRegistryFromExpression(
            decl.initializer,
            typeChecker,
            logger
          );
        }
      });
    }
    ts.forEachChild(node, visit);
  });

  return registry;
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

class TypeBasedPropRegistryExtractor {
  constructor(
    private readonly typeChecker: ts.TypeChecker,
    private readonly logger: Logger
  ) {}

  extract(symbol: ts.Symbol, sourceFile: ts.SourceFile): PropRegistry | null {
    // This is a simplified version
    // In reality, we would analyze the type and extract prop definitions
    this.logger.debug('Extracting PropRegistry from type', {
      symbolName: symbol.getName(),
      fileName: sourceFile.fileName,
    });

    return getDefaultPropRegistry();
  }
}
