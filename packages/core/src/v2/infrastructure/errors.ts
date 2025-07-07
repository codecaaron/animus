/**
 * Error handling infrastructure for static extraction
 */

import * as ts from 'typescript';

export type ErrorStrategy = 'fail-fast' | 'continue' | 'warn-only';

export interface ErrorHandler {
  readonly strategy: ErrorStrategy;
  handle<T>(operation: () => T, fallback: T): T;
  report(error: ExtractionError): void;
  summarize(): ErrorSummary;
}

export interface ExtractionError {
  readonly phase: 'discovery' | 'reconstruction' | 'collection' | 'computation';
  readonly severity: 'fatal' | 'error' | 'warning';
  readonly code: string;
  readonly message: string;
  readonly node?: ts.Node;
  readonly stack?: string;
}

export interface ErrorSummary {
  readonly totalErrors: number;
  readonly byPhase: Record<string, number>;
  readonly bySeverity: Record<string, number>;
  readonly fatalErrors: ExtractionError[];
}

export class ErrorHandlerImpl implements ErrorHandler {
  readonly strategy: ErrorStrategy;
  private readonly errors: ExtractionError[] = [];

  constructor(strategy: ErrorStrategy) {
    this.strategy = strategy;
  }

  handle<T>(operation: () => T, fallback: T): T {
    try {
      return operation();
    } catch (error) {
      const extractionError: ExtractionError = {
        phase: 'discovery', // Would need context to determine actual phase
        severity: 'error',
        code: 'OPERATION_FAILED',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      };

      this.report(extractionError);

      if (this.strategy === 'fail-fast') {
        throw error;
      }

      return fallback;
    }
  }

  report(error: ExtractionError): void {
    this.errors.push(error);
  }

  summarize(): ErrorSummary {
    const byPhase: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};

    for (const error of this.errors) {
      byPhase[error.phase] = (byPhase[error.phase] || 0) + 1;
      bySeverity[error.severity] = (bySeverity[error.severity] || 0) + 1;
    }

    return {
      totalErrors: this.errors.length,
      byPhase,
      bySeverity,
      fatalErrors: this.errors.filter((e) => e.severity === 'fatal'),
    };
  }
}
