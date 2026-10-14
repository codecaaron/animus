/**
 * What the webpack plugin and its loader share. webpack loads the loader
 * from its own file, a module instance apart from the plugin's, so the
 * state is kept on `globalThis`, by plugin id.
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ownership, Units } from './host';
import type { LayergatePlan } from './plan';

export interface WebpackState {
  plan: LayergatePlan;
  owner: ReturnType<typeof ownership>;
  /** Owned files whose own rules stay unlayered, by realpath. */
  optedOut: Set<string>;
  /** The stylesheet whose head delivers the declared sheets, by realpath. */
  declaredBy: string | null;
  /** Parsed files, the files each finished stylesheet read, and reach
   *  answers, kept between compiles. */
  units: Units;
}

/** CSS resolution as css-loader resolves an `@import`: the `style`
 *  condition alone, its fields, CSS files only, relative first. */
export const CSS_RESOLVE = {
  conditionNames: ['style'],
  mainFields: ['css', 'style', 'main', '...'],
  mainFiles: ['index', '...'],
  extensions: ['.css'],
  restrictions: [/\.css$/i],
  preferRelative: true,
};

const KEY = Symbol.for('@animus-ui/layergate/webpack');

export function registry(): Map<string, WebpackState> {
  // SAFETY: the one value stored under this symbol is this map.
  const global = globalThis as { [KEY]?: Map<string, WebpackState> };
  return (global[KEY] ??= new Map());
}

const here = dirname(fileURLToPath(import.meta.url));

/** The loader's file: the built one beside this module, or the source in
 *  the workspace. */
export function loaderPath(): string {
  for (const built of ['webpack-loader.cjs', 'webpack-loader.mjs']) {
    const path = resolve(here, built);
    if (existsSync(path)) return path;
  }
  return resolve(here, 'webpack-loader.ts');
}
