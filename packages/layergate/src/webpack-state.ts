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

/** css-loader's options that decide whether it reads a stylesheet as a
 *  CSS Module or an ICSS sheet. */
export interface ModuleOptions {
  modules?: unknown;
  icss?: unknown;
}

const BY_NAME = /\.(?:modules?|icss)\.\w+$/i;

/** Whether css-loader with `options` reads every stylesheet as a CSS
 *  Module or ICSS sheet, whatever its name. */
export function alwaysModules(options: ModuleOptions): boolean {
  const { modules, icss } = options;
  if (icss === true || modules === true) return true;
  // A mode name (`local`, `global`, `pure`, `icss`).
  if (Object.prototype.toString.call(modules) === '[object String]') {
    return true;
  }
  return (
    modules instanceof Object &&
    !(modules instanceof Function) &&
    !('auto' in modules && modules.auto !== undefined)
  );
}

/**
 * Whether css-loader with `options` reads `resourcePath` as a CSS Module
 * or ICSS sheet, whose `:export`s a layer would hide. As css-loader (and
 * Next's copy) decides: unset `modules` by name; `false` never; `true` or
 * a mode always; an object by its `auto` (a boolean by name, a RegExp, a
 * function), or always without one. Names cover css-loader's `.module.`,
 * `.modules.` and `.icss.`.
 */
export function isModuleSheet(
  resourcePath: string,
  options: ModuleOptions
): boolean {
  if (alwaysModules(options)) return true;
  const { modules } = options;
  if (modules === undefined) return BY_NAME.test(resourcePath);
  if (!(modules instanceof Object)) return false;
  // SAFETY: css-loader's `modules` object, read for `auto`.
  const { auto } = modules as { auto?: unknown };
  if (auto instanceof RegExp) return auto.test(resourcePath);
  if (auto instanceof Function) return Boolean(auto(resourcePath));
  return auto === true && BY_NAME.test(resourcePath);
}

const KEY = Symbol.for('@animus-ui/layergate/webpack');

/** Every plugin's state by id, and how many plugins were made: shared by
 *  every copy of this module in the process (its ESM and CJS builds), so
 *  no two plugins get one id. */
export interface Registry {
  states: Map<string, WebpackState>;
  made: number;
}

export function registry(): Registry {
  // SAFETY: the one value stored under this symbol is this registry.
  const global = globalThis as { [KEY]?: Registry };
  return (global[KEY] ??= { states: new Map(), made: 0 });
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
