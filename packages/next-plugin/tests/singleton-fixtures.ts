import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { SINGLETON_GLOBAL_KEYS } from '../src/singleton';

/**
 * Shared, webpack-free fixtures for the next-plugin behavioral suites: the
 * singleton globalThis hygiene, the canned SystemConfig, the Button project
 * corpus, and the canonical manifest builder. Suites (and the webpack
 * gauntlet harness, which re-exports for its test files) import these
 * instead of re-declaring them.
 */

/** Every globalThis key owned by src/singleton.ts — sourced from the
 *  singleton's own exported list, never re-declared. */
export const ANIMUS_GLOBAL_KEYS = SINGLETON_GLOBAL_KEYS;

/**
 * Clear every singleton-owned global (simulating a fresh process) and
 * return a restorer for afterEach. Callers that only want the clearing
 * (gauntlet sessions) ignore the return value.
 */
export function resetAnimusGlobals(): () => void {
  const g = globalThis as Record<string, unknown>;
  const saved: Record<string, unknown> = {};
  for (const key of ANIMUS_GLOBAL_KEYS) {
    saved[key] = g[key];
    g[key] = undefined;
  }
  return () => {
    Object.assign(g, saved);
  };
}

/** Canned loadSystemModule return value (NAPI camelCase surface). */
export const SYSTEM_CONFIG = {
  propConfig: '{"props":{}}',
  groupRegistry: '{"groups":{}}',
  scalesJson: '{"space":{}}',
  variableMapJson: '{"map":{}}',
  variableCss: ':root{--anm-space-1: 4px}',
  contextualVarsJson: null,
  selectorAliases: null,
  globalStyleBlocks: null,
  keyframesBlocks: null,
};

export const BUTTON_SOURCE =
  "export const Button = animus.styles({ margin: 8 }).asElement('button');\n";
/** Style-value-only edit — replacement plans unchanged. */
export const BUTTON_STYLE_EDIT =
  "export const Button = animus.styles({ margin: 16 }).asElement('button');\n";
/** Config-shape edit — replacement plans move. */
export const BUTTON_SHAPE_EDIT =
  "export const Button = animus.styles({ margin: 16 }).variant({}).asElement('button');\n";

export const PLAN_A = {
  'src/Button.tsx::Button': {
    file: 'src/Button.tsx',
    replacement: "createComponent('button', 'a')",
  },
};
export const PLAN_B = {
  'src/Button.tsx::Button': {
    file: 'src/Button.tsx',
    replacement: "createComponent('button', 'b')",
  },
};

/** Canonical engine-manifest JSON for a component set. */
export function buildManifest(
  components: Record<string, unknown>,
  css = '.btn{margin:8px;}'
): string {
  return JSON.stringify({
    components,
    css,
    sheets: { global: '' },
    system_prop_map: {},
    dynamic_props: {},
    diagnostics: [],
  });
}

const createdRoots: string[] = [];

/** Temp project carrying src/system.ts + src/Button.tsx. Roots are
 *  registered for `cleanupProjects` (call it from afterEach). */
export function createProject(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  createdRoots.push(root);
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(
    join(root, 'src', 'system.ts'),
    'export const system = { space: [0, 4, 8] };\n'
  );
  writeFileSync(join(root, 'src', 'Button.tsx'), BUTTON_SOURCE);
  return root;
}

/** Remove every project `createProject` made since the last cleanup. */
export function cleanupProjects(): void {
  for (const root of createdRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
}
