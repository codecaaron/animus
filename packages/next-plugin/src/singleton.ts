/**
 * Module-scope singleton for sharing analysis state between the webpack plugin and loader.
 *
 * Uses globalThis to survive the ESM/CJS module boundary: the plugin is loaded via ESM
 * (next.config.ts import) while the loader is loaded by webpack via require(). Without
 * globalThis, each module system gets its own singleton instance.
 */

const MANIFEST_KEY = '__animus_manifest_json__';
const PROMISE_KEY = '__animus_analysis_promise__';
const SHARED_CSS_KEY = '__animus_shared_css__';
const SHARED_SYSTEM_PROPS_KEY = '__animus_shared_system_props__';

export function getManifestJson(): string | null {
  return (globalThis as Record<string, unknown>)[MANIFEST_KEY] as string | null;
}

export function setManifestJson(json: string): void {
  (globalThis as Record<string, unknown>)[MANIFEST_KEY] = json;
}

export function getAnalysisPromise(): Promise<void> | null {
  return (globalThis as Record<string, unknown>)[
    PROMISE_KEY
  ] as Promise<void> | null;
}

export function setAnalysisPromise(promise: Promise<void>): void {
  (globalThis as Record<string, unknown>)[PROMISE_KEY] = promise;
}

export function resetAnalysisPromise(): void {
  (globalThis as Record<string, unknown>)[PROMISE_KEY] = null;
}

export function getSharedCss(): string {
  return ((globalThis as Record<string, unknown>)[SHARED_CSS_KEY] as string) || '';
}

export function setSharedCss(css: string): void {
  (globalThis as Record<string, unknown>)[SHARED_CSS_KEY] = css;
}

export function getSharedSystemProps(): string {
  return ((globalThis as Record<string, unknown>)[SHARED_SYSTEM_PROPS_KEY] as string) || '';
}

export function setSharedSystemProps(content: string): void {
  (globalThis as Record<string, unknown>)[SHARED_SYSTEM_PROPS_KEY] = content;
}
