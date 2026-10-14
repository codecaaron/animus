/**
 * layergate's webpack loader. It runs on each global stylesheet before
 * PostCSS and css-loader (the plugin inserts it so). The declared sheets'
 * stylesheet gets them at its head; a declared sheet a module imports
 * itself loads nothing; an owned stylesheet is finished as an owned graph;
 * an app stylesheet whose imports reach an owned file is finished with its
 * own rules unlayered; anything else passes through. A finished stylesheet
 * has no local `@import` left, and a remote one that would need a layer is
 * refused: Next's css-loader renders `layer()` as media.
 */
import { dirname } from 'node:path';

import { compileUnit } from './compile';
import { formatDiagnostic, slashes } from './host';
import { readSheet } from './sheet';
import { CSS_RESOLVE, isModuleSheet, registry } from './webpack-state';

import type { CompiledUnit, CompileOptions } from './compile';
import type { ModuleOptions, WebpackState } from './webpack-state';

type SourceMap = CompiledUnit['map'];

/** The source map and metadata the loaders before this one passed on,
 *  handed through untouched when the stylesheet passes. */
interface IncomingMap {
  readonly mappings?: string;
}
interface IncomingMeta {
  readonly ast?: { readonly type?: string };
}

/** The loader context, as far as layergate reads it. */
interface LoaderContext {
  resourcePath: string;
  rootContext: string;
  getOptions(): { id?: string } & ModuleOptions;
  /** Whether webpack may cache this module's build. */
  cacheable(flag: boolean): void;
  async(): (
    error: Error | null,
    code?: string,
    map?: SourceMap | IncomingMap,
    meta?: IncomingMeta
  ) => void;
  getResolve(
    options: typeof CSS_RESOLVE
  ): (context: string, request: string) => Promise<string | false>;
  fs: {
    readFile(
      path: string,
      done: (error: Error | null, data?: Buffer | string) => void
    ): void;
  };
  addDependency(file: string): void;
  emitError(error: Error): void;
  emitWarning(error: Error): void;
}

/** A file through the compiler's file system. */
const readFrom = (context: LoaderContext) => (path: string) =>
  new Promise<string>((done, fail) =>
    context.fs.readFile(path, (error, data) =>
      error ? fail(error) : done(String(data))
    )
  );

/** The file an `@import` in `importer` reaches, where css-loader would
 *  reach it: by realpath unless `resolve.symlinks` is false. */
const resolveFrom = (context: LoaderContext) => {
  const resolver = context.getResolve(CSS_RESOLVE);
  return async (specifier: string, importer: string) => {
    const resolved = await resolver(dirname(importer), specifier).catch(
      () => null
    );
    return resolved ? slashes(resolved) : null;
  };
};

async function finish(
  context: LoaderContext,
  state: WebpackState,
  file: string,
  source: string,
  roots: readonly string[],
  extra: Partial<CompileOptions> = {}
): Promise<CompiledUnit> {
  const readFile = readFrom(context);
  const read = (path: string) =>
    path === file ? Promise.resolve(source) : readFile(path);
  // The stylesheet itself arrives as the loaders before this one left it.
  state.units.parsed.delete(file);
  // Files flow as webpack reads them, so URLs resolve as css-loader
  // resolves them; who owns a file, opt-outs and the declared sheets go by
  // realpath. The `declaredBy` stylesheet is never layered.
  const { units, owner, optedOut, declaredBy } = state;
  const unit = await compileUnit(roots, {
    layer: state.plan.layer,
    order: state.plan.order,
    base: context.rootContext,
    resolve: resolveFrom(context),
    read,
    quarantined: (path) => {
      const canonical = units.canonical(path);
      return !optedOut.has(canonical) && canonical !== declaredBy;
    },
    owns: (path) => owner.owns(units.canonical(path)),
    remote: 'refuse',
    cache: state.units.parsed,
    ...extra,
  });
  state.units.record(file, unit.files);
  for (const path of unit.files) context.addDependency(path);
  for (const diagnostic of unit.diagnostics) {
    const error = new Error(formatDiagnostic(diagnostic));
    if (diagnostic.severity === 'error') context.emitError(error);
    else if (diagnostic.severity === 'warning') context.emitWarning(error);
  }
  return unit;
}

async function run(
  context: LoaderContext,
  source: string
): Promise<{ code: string; map: SourceMap } | null> {
  const options = context.getOptions();
  const state = registry().states.get(options.id ?? '');
  // css-loader reads a CSS Module's `:export`s, which a layer would hide.
  if (!state || isModuleSheet(context.resourcePath, options)) return null;
  const file = slashes(context.resourcePath);
  const id = state.units.canonical(file);
  const { owner, declaredBy } = state;
  // Whatever layergate returns depends on files and state webpack's cache
  // does not know about, so it is never cached: it is finished again on
  // a warm start and each compile.
  if (id === declaredBy) {
    if (owner.declared.length === 0) return null;
    // URLs relative to this stylesheet, which css-loader resolves and
    // emits, a file outside the root too.
    const unit = await finish(context, state, file, source, owner.declared, {
      delivery: file,
      map: false,
    });
    context.cacheable(false);
    return { code: `${unit.css}\n${source}`, map: null };
  }
  if (!owner.owning()) return null;
  // Delivered at the head of `declaredBy`, once.
  if (declaredBy && owner.declared.includes(id)) {
    context.cacheable(false);
    return { code: '', map: null };
  }
  if (!owner.owns(id)) {
    const { imports } = readSheet(source);
    if (imports.length === 0) return null;
    const reached = await state.units.reaches(file, imports, {
      resolve: resolveFrom(context),
      read: readFrom(context),
      owns: (path) => owner.owns(state.units.canonical(path)),
    });
    if (!reached) return null;
  }
  const unit = await finish(context, state, file, source, [file]);
  context.cacheable(false);
  return { code: unit.css, map: unit.map };
}

export default function layergateLoader(
  this: LoaderContext,
  source: string,
  map?: IncomingMap,
  meta?: IncomingMeta
): void {
  const done = this.async();
  run(this, source).then(
    (finished) =>
      finished
        ? done(null, finished.code, finished.map)
        : done(null, source, map, meta),
    (error: Error) => done(error)
  );
}
