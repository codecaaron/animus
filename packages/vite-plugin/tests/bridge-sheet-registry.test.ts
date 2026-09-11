import { describe, expect, it } from 'vitest';

import { RESOLVED_BRIDGE_ID } from '../src/constants';
import { PluginContext } from '../src/context';
import { loadVirtualModule } from '../src/virtual-modules';

import type { AnimusExtractOptions } from '../src/index';

/** The bridge adopts its sheet from a `globalThis` key: two plugin instances
 *  sharing one key overwrite each other's component CSS on every update. */

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
    // and every custom property in the served component CSS.
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
    // Identical configurations share, which prevents a duplicate adoption.
    expect(registryKey({ system: './src/ds.ts', prefix: 'app' })).toBe(
      registryKey({ prefix: 'app', system: './src/ds.ts' })
    );
  });

  it('namespaces the style-element fallback with the same key', () => {
    const source = bridgeModule({ system: './src/ds.ts' });
    const key = registryKey({ system: './src/ds.ts' });
    const hash = key.slice('__animus_sheet_'.length, -'__'.length);

    expect(source).toContain(`data-animus-components="${hash}"`);
    expect(source).not.toContain('style[data-animus-components]');
  });
});
