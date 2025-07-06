/**
 * Diagnostics collection for static extraction
 */

import type { ExtractionError } from './errors';

export interface DiagnosticsCollector {
  recordPhaseStart(phase: string): void;
  recordPhaseEnd(phase: string): void;
  recordMetric(name: string, value: number, unit?: string): void;
  recordDecision(type: string, nodeId: string, confidence: number): void;
  recordError(phase: string, error: Error | ExtractionError): void;
  generateReport(): DiagnosticsReport;
}

export interface DiagnosticsReport {
  readonly phases: Record<string, PhaseMetrics>;
  readonly metrics: Record<string, number[]>;
  readonly decisions: DecisionRecord[];
  readonly errors: ErrorRecord[];
  readonly summary: {
    totalTime: number;
    totalErrors: number;
    componentsFound: number;
    atomicsGenerated: number;
  };
}

export interface PhaseMetrics {
  startTime: number;
  endTime: number;
  duration: number;
  errors: number;
}

export interface DecisionRecord {
  type: string;
  nodeId: string;
  confidence: number;
  timestamp: number;
}

export interface ErrorRecord {
  phase: string;
  message: string;
  stack?: string;
  timestamp: number;
}

export class SimpleDiagnosticsCollector implements DiagnosticsCollector {
  private phases: Map<string, PhaseMetrics> = new Map();
  private metrics: Map<string, number[]> = new Map();
  private decisions: DecisionRecord[] = [];
  private errors: ErrorRecord[] = [];
  private currentPhase: string | null = null;

  recordPhaseStart(phase: string): void {
    this.currentPhase = phase;
    this.phases.set(phase, {
      startTime: Date.now(),
      endTime: 0,
      duration: 0,
      errors: 0,
    });
  }

  recordPhaseEnd(phase: string): void {
    const phaseData = this.phases.get(phase);
    if (phaseData) {
      phaseData.endTime = Date.now();
      phaseData.duration = phaseData.endTime - phaseData.startTime;
    }
    if (this.currentPhase === phase) {
      this.currentPhase = null;
    }
  }

  recordMetric(name: string, value: number, unit?: string): void {
    const values = this.metrics.get(name) || [];
    values.push(value);
    this.metrics.set(name, values);
  }

  recordDecision(type: string, nodeId: string, confidence: number): void {
    this.decisions.push({
      type,
      nodeId,
      confidence,
      timestamp: Date.now(),
    });
  }

  recordError(phase: string, error: Error | ExtractionError): void {
    const errorRecord: ErrorRecord = {
      phase,
      message: error.message,
      stack: error.stack,
      timestamp: Date.now(),
    };
    this.errors.push(errorRecord);

    // Update phase error count
    const phaseData = this.phases.get(phase);
    if (phaseData) {
      phaseData.errors++;
    }
  }

  generateReport(): DiagnosticsReport {
    const phasesObj: Record<string, PhaseMetrics> = {};
    for (const [name, data] of this.phases) {
      phasesObj[name] = data;
    }

    const metricsObj: Record<string, number[]> = {};
    for (const [name, values] of this.metrics) {
      metricsObj[name] = values;
    }

    const componentsFound = this.metrics.get('componentsFound')?.[0] || 0;
    const atomicsGenerated = this.metrics.get('atomicsGenerated')?.[0] || 0;

    const totalTime = Array.from(this.phases.values()).reduce(
      (sum, phase) => sum + phase.duration,
      0
    );

    return {
      phases: phasesObj,
      metrics: metricsObj,
      decisions: this.decisions,
      errors: this.errors,
      summary: {
        totalTime,
        totalErrors: this.errors.length,
        componentsFound,
        atomicsGenerated,
      },
    };
  }
}
