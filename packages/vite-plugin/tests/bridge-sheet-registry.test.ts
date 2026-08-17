import { describe, expect, it } from 'vitest';

import { RESOLVED_BRIDGE_ID } from '../src/constants';
import { PluginContext } from '../src/context';
import { loadVirtualModule } from '../src/virtual-modules';

import type { AnimusExtractOptions } from '../src/index';

/**
 * The browser bridge holds its `CSSStyleSheet` in a `globalThis` registry
 * entry so an HMR re-evaluation of the module adopts the existing sheet
 * instead of appending a duplicate. That entry is shared build-time state
 * across every plugin instance on the page, and each instance's
 * `replaceSync(css)` overwrites the whole sheet — so two instances landing on
 * one key means the last loader's component CSS wins and the other's
 * components lose every rule (openspec: vite-extraction-plugin, "HMR state
 * namespaced by system path hash").
 */

function bridgeModule(options: AnimusExtractOptions): string {
  const ctx = new PluginContext(options);
  const source = loadVirtualModule(ctx, RESOLVED_BRIDGE_ID);
  if (source === null) throw new Error('bridge module must be served');
  return source;
}

function registryKey(options: AnimusExtractOptions): string {
  const key = /__animus_sheet_[0-9a-f]+__/.exec(bridgeModule(options));
  if (!key) throw new Error('bridge module must carry a registry key');
  return key[0];
}

describe('browser bridge sheet registry key', () => {
  it('separates instances whose emitted bytes differ', () => {
    // Same system module, different emission: `prefix` renames every class
    // and every custom property in the served component CSS. Sharing a sheet
    // here is not a near-miss — each instance wholesale-replaces the other's
    // stylesheet on every update.
    const base: AnimusExtractOptions = { system: './src/ds.ts' };

    expect(registryKey({ ...base, prefix: 'app' })).not.toBe(
      registryKey({ ...base, prefix: 'docs' })
    );
  });

  it.each([
    ['layers', { layers: ['anm-base', 'overrides'] }],
    ['mode', { mode: 'production' as const }],
    ['targets', { targets: 'chrome 120' }],
    ['minify', { minify: true }],
    ['extensions', { extensions: ['.ts'] }],
    ['exclude', { exclude: ['stories'] }],
    ['runtimeImport', { runtimeImport: '@animus-ui/system/class-resolver' }],
    ['staticCss', { staticCss: { systemProps: { p: [4] } } }],
  ])('separates instances differing only in %s', (_name, override) => {
    const base: AnimusExtractOptions = { system: './src/ds.ts' };

    expect(registryKey(base)).not.toBe(registryKey({ ...base, ...override }));
  });

  it('keeps one key for one configuration, however it is spelled', () => {
    // The key must be stable across module re-evaluation, and two instances
    // configured identically SHOULD share — that is what stops a second
    // adoption of the same stylesheet.
    expect(registryKey({ system: './src/ds.ts', prefix: 'app' })).toBe(
      registryKey({ prefix: 'app', system: './src/ds.ts' })
    );
  });

  it('namespaces the style-element fallback with the same key', () => {
    // The non-adoptedStyleSheets branch writes a `<style>` element instead;
    // an unnamespaced selector collides for exactly the same reason.
    const source = bridgeModule({ system: './src/ds.ts' });
    const key = registryKey({ system: './src/ds.ts' });
    const hash = key.slice('__animus_sheet_'.length, -'__'.length);

    expect(source).toContain(`data-animus-components="${hash}"`);
    expect(source).not.toContain('style[data-animus-components]');
  });
});
