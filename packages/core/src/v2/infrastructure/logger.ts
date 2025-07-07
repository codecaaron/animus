/**
 * Logging infrastructure for static extraction
 */

export interface Logger {
  debug(message: string, data?: any): void;
  info(message: string, data?: any): void;
  warn(message: string, data?: any): void;
  error(message: string, error?: Error | any): void;
  child(scope: string): Logger;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export class ConsoleLogger implements Logger {
  constructor(
    private readonly scope: string = 'StaticExtractor',
    private level: LogLevel = 'info'
  ) {}

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error', 'silent'];
    return levels.indexOf(level) >= levels.indexOf(this.level);
  }

  debug(message: string, data?: any): void {
    if (this.shouldLog('debug')) {
      // biome-ignore lint/suspicious/noConsole: Logger implementation requires console
      console.log(`[${this.scope}] DEBUG: ${message}`, data || '');
    }
  }

  info(message: string, data?: any): void {
    if (this.shouldLog('info')) {
      // biome-ignore lint/suspicious/noConsole: Logger implementation requires console
      console.log(`[${this.scope}] INFO: ${message}`, data || '');
    }
  }

  warn(message: string, data?: any): void {
    if (this.shouldLog('warn')) {
      // biome-ignore lint/suspicious/noConsole: Logger implementation requires console
      console.warn(`[${this.scope}] WARN: ${message}`, data || '');
    }
  }

  error(message: string, error?: Error | any): void {
    if (this.shouldLog('error')) {
      // biome-ignore lint/suspicious/noConsole: Logger implementation requires console
      console.error(`[${this.scope}] ERROR: ${message}`, error || '');
    }
  }

  child(scope: string): Logger {
    return new ConsoleLogger(`${this.scope}.${scope}`, this.level);
  }
}
