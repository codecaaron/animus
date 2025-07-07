/**
 * Caching infrastructure for static extraction
 */

export type CacheStrategy = 'memory' | 'disk' | 'hybrid';

export interface CacheManager {
  readonly strategy: CacheStrategy;
  get<T>(key: CacheKey): T | undefined;
  set<T>(key: CacheKey, value: T, ttl?: number): void;
  invalidate(pattern: string): void;
  clear(): void;
}

export interface CacheKey {
  readonly type: 'component' | 'usage' | 'atomic';
  readonly id: string;
  readonly version: string; // File content hash
}

export class MemoryCacheManager implements CacheManager {
  readonly strategy: CacheStrategy;
  private readonly cache = new Map<
    string,
    { value: unknown; expires?: number }
  >();

  constructor(strategy: CacheStrategy = 'memory') {
    this.strategy = strategy;
  }

  get<T>(key: CacheKey): T | undefined {
    const cacheKey = this.serializeKey(key);
    const entry = this.cache.get(cacheKey);

    if (!entry) return undefined;

    if (entry.expires && Date.now() > entry.expires) {
      this.cache.delete(cacheKey);
      return undefined;
    }

    return entry.value as T;
  }

  set<T>(key: CacheKey, value: T, ttl?: number): void {
    const cacheKey = this.serializeKey(key);
    const expires = ttl ? Date.now() + ttl : undefined;

    this.cache.set(cacheKey, { value, expires });
  }

  invalidate(pattern: string): void {
    const regex = new RegExp(pattern);
    for (const [key] of this.cache) {
      if (regex.test(key)) {
        this.cache.delete(key);
      }
    }
  }

  clear(): void {
    this.cache.clear();
  }

  private serializeKey(key: CacheKey): string {
    return `${key.type}:${key.id}:${key.version}`;
  }
}
