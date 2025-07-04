/**
 * Cache coordination between TypeScript transformer and webpack loader phases
 * Handles persistence of extracted metadata across compilation boundaries
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ComponentRuntimeMetadata } from '@animus-ui/core/static';
import type { ComponentIdentity } from '@animus-ui/core/static';

export interface AnimusCacheData {
  version: string;
  timestamp: number;
  rootDir: string;
  registry: SerializedRegistry;
  metadata: Record<string, ComponentRuntimeMetadata>;
  css: string;
  layeredCSS: {
    cssVariables: string;
    baseStyles: string;
    variantStyles: string;
    stateStyles: string;
    atomicUtilities: string;
    customPropUtilities: string;
  };
}

export interface SerializedRegistry {
  components: Record<string, SerializedComponent>;
  componentsByFile: Record<string, ComponentIdentity[]>;
  globalUsage: Record<string, any>;
}

export interface SerializedComponent {
  identity: ComponentIdentity;
  filePath: string;
  parentId?: string;
  extractedStyles: any;
  usages: any[];
}

/**
 * Get the default cache directory
 */
export function getDefaultCacheDir(): string {
  // Try Next.js cache directory first
  const nextCacheDir = path.join(process.cwd(), '.next', 'cache');
  if (fs.existsSync(path.dirname(nextCacheDir))) {
    return nextCacheDir;
  }
  
  // Fallback to node_modules/.cache
  return path.join(process.cwd(), 'node_modules', '.cache', 'animus');
}

/**
 * Get the cache file path
 */
export function getCacheFilePath(cacheDir?: string): string {
  const dir = cacheDir || getDefaultCacheDir();
  return path.join(dir, 'animus-metadata.json');
}

/**
 * Write cache data to filesystem
 */
export function writeAnimusCache(data: AnimusCacheData, cacheDir?: string): void {
  const filePath = getCacheFilePath(cacheDir);
  const dir = path.dirname(filePath);
  
  // Ensure directory exists
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  // Write cache file
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Read cache data from filesystem
 */
export function readAnimusCache(cacheDir?: string): AnimusCacheData | null {
  const filePath = getCacheFilePath(cacheDir);
  
  if (!fs.existsSync(filePath)) {
    return null;
  }
  
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content) as AnimusCacheData;
    
    // Validate cache version
    if (data.version !== '1.0.0') {
      console.warn(`[Animus] Cache version mismatch: ${data.version}`);
      return null;
    }
    
    return data;
  } catch (error) {
    console.error('[Animus] Failed to read cache:', error);
    return null;
  }
}

/**
 * Clear the cache
 */
export function clearAnimusCache(cacheDir?: string): void {
  const filePath = getCacheFilePath(cacheDir);
  
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

/**
 * Check if cache is stale based on file modification times
 */
export function isCacheStale(data: AnimusCacheData, fileModifiedTime: number): boolean {
  return fileModifiedTime > data.timestamp;
}

// Memory cache for development (optional)
let memoryCache: AnimusCacheData | null = null;

/**
 * Get cache from memory (for development)
 */
export function getMemoryCache(): AnimusCacheData | null {
  return memoryCache;
}

/**
 * Set cache in memory (for development)
 */
export function setMemoryCache(data: AnimusCacheData): void {
  memoryCache = data;
}

/**
 * Clear memory cache
 */
export function clearMemoryCache(): void {
  memoryCache = null;
}