/**
 * Performance monitoring infrastructure for static extraction
 */

export interface PerformanceMonitor {
  startPhase(phase: string): PhaseTimer;
  recordMetric(name: string, value: number): void;
  getReport(): PerformanceReport;
}

export interface PhaseTimer {
  checkpoint(name: string): void;
  end(): void;
}

export interface PerformanceReport {
  readonly totalTimeMs: number;
  readonly phaseTimings: Record<string, number>;
  readonly metrics: Record<string, number[]>;
  readonly memoryUsage: MemoryStats;
}

export interface MemoryStats {
  readonly heapUsed: number;
  readonly heapTotal: number;
  readonly external: number;
  readonly arrayBuffers: number;
}

export class PerformanceMonitorImpl implements PerformanceMonitor {
  private readonly enabled: boolean;
  private readonly phaseTimings = new Map<string, number>();
  private readonly metrics = new Map<string, number[]>();
  private readonly activeTimers = new Map<string, number>();
  private startTime = 0;

  constructor(enabled = true) {
    this.enabled = enabled;
    this.startTime = performance.now();
  }

  startPhase(phase: string): PhaseTimer {
    if (!this.enabled) {
      return { checkpoint: () => {}, end: () => {} };
    }

    const startTime = performance.now();
    this.activeTimers.set(phase, startTime);

    return {
      checkpoint: (name: string) => {
        this.recordMetric(`${phase}.${name}`, performance.now() - startTime);
      },
      end: () => {
        const duration = performance.now() - startTime;
        this.phaseTimings.set(phase, duration);
        this.activeTimers.delete(phase);
      },
    };
  }

  recordMetric(name: string, value: number): void {
    if (!this.enabled) return;

    const values = this.metrics.get(name) || [];
    values.push(value);
    this.metrics.set(name, values);
  }

  getReport(): PerformanceReport {
    const memUsage = process.memoryUsage();

    return {
      totalTimeMs: performance.now() - this.startTime,
      phaseTimings: Object.fromEntries(this.phaseTimings),
      metrics: Object.fromEntries(this.metrics),
      memoryUsage: {
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        external: memUsage.external,
        arrayBuffers: memUsage.arrayBuffers,
      },
    };
  }
}
