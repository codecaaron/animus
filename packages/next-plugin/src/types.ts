import type {
  AnimusQuarantineOptions,
  ClosedDynamicImport,
  FontPreloadEntry,
  DiagnosticLevels,
  StaticCssConfig,
} from '@animus-ui/extract/pipeline';

export interface AnimusNextOptions {
  /** Path to a module exporting a SystemInstance from `@animus-ui/system`. */
  system: string;
  /** The system's export name in the `system` module. The loader runs only
   *  what that export reaches, and finds it itself when exactly one export
   *  is a sealed system (`.seal()`) and every other export is plainly not
   *  one; otherwise it asks for this option by name. */
  systemExport?: string;
  /** The app's directory, for a `next` run from another directory. Next
   *  passes no dir to a config module, so the app's root is the current
   *  directory without it. Its source kits and analysis read this root; under
   *  webpack, a root that is not Next's dir fails. A relative root resolves
   *  against the current directory when `withAnimus()` is called, not
   *  against `next.config`'s directory. */
  root?: string;
  /** Substrings, or globs when `*`/`?` present. Replaces `dist`/`.test.`/
   *  `.spec.`; `node_modules`, `.next` and `.animus` are always excluded. */
  exclude?: string[];
  /** Extensions scanned for definitions and usages; replaces the default
   *  `['.ts','.tsx','.js','.jsx','.mdx']`. `.mdx` is read for the components
   *  it renders, with no MDX compiler; any reference to the builder in it is
   *  an error (see the README's MDX section). */
  extensions?: string[];
  /** When true, error-severity diagnostics — lost configured inputs and
   *  classified unsupported Animus declarations — and failed checks, such as
   *  an unresolved include or `asset()` specifier or a failed module
   *  transform, fail a build instead of warning. `next dev` reports them and
   *  keeps running. Omitted or `false` warns. */
  strict?: boolean;
  /**
   * Each `animus.*` code's level, by exact code, by a prefix ending in `.*`
   * (`'animus.style.*'`), or by kind (`'kind:bail'`, `'kind:skip'`,
   * `'kind:warn'`, `'kind:error'`): `'off'`, `'info'`, `'warn'` or `'error'`,
   * which fails a build and is reported by `next dev`, which keeps running.
   * An exact code beats the longest matching prefix, which beats a kind, and
   * an entry beats `strict` and the code's own severity.
   */
  diagnostics?: DiagnosticLevels;
  /** Project-root-relative path of the one file that receives the stylesheet
   *  import; replaces the `app/layout.*` / `pages/_app.*` detection. */
  cssImportTarget?: string;
  verbose?: boolean | 'trace';
  /** Namespace prefix for the names Animus generates: theme token
   *  variables, classes and slots. Contextual variables keep their declared
   *  names unless `prefixContextualVars` is set. */
  prefix?: string;
  /** With `prefix` set, contextual variables take the prefixed name
   *  everywhere Animus emits them, while authors keep writing the declared
   *  name. */
  prefixContextualVars?: boolean;
  /** Forced-emission declarations for usage the scanner cannot observe
   *  (CMS-driven variants, spread-hidden props). Absent is a no-op. */
  staticCss?: StaticCssConfig;
  /** Browserslist query string or array. Falls back to the project's
   *  browserslist config, then to `defaults`. */
  targets?: string | string[];
  /** `true`/`false` force minification on or off; absent minifies in
   *  production. Autoprefixing applies either way. */
  minify?: boolean;
  /** Explicit emission mode, winning over the environment signal that
   *  otherwise decides minification and the dev-diagnostics define. */
  mode?: 'development' | 'production';
  /** `'v2'` is the only engine and the default. `engine: 'v1'` or
   *  `ANIMUS_ENGINE=v1` throws — the selection is never silently upgraded. */
  engine?: 'v2';
  /** `'auto'` (default) generates Turbopack wiring whenever the `TURBOPACK`
   *  environment variable is set; `'on'` always, `'off'` never. */
  turbopack?: { mode?: 'auto' | 'on' | 'off' };
  /** Next's config phase, for a config function of your own that returns
   *  this one under Turbopack: `(phase) => withAnimus({ ...options, phase
   *  })(nextConfig)`. Next calls a config exported directly with its phase,
   *  and that phase wins. Without either, `NODE_ENV=development` reads as
   *  `next dev`. */
  phase?: string;
  /** @deprecated Use `turbopack` — same shape, and it wins when both are
   *  set. This alias warns once. */
  unstable_turbopack?: { mode?: 'off' | 'auto' | 'on' };
  /** @internal Absolute path of a loader module registered in place of this
   *  package's own; feeds the needBuild loader-chain predicate. */
  loaderPath?: string;
  /** Full `@layer` declaration order, emitted as-is. Must contain the seven
   *  `anm-*` layers as a subsequence; consumer layers may be interleaved. */
  layers?: string[];
  /** The module extracted terminals import their factories from; default
   *  `@animus-ui/system/runtime`. `@animus-ui/system` also supplies every
   *  terminal; another override must supply every terminal used. */
  runtimeImport?: string;
  /** Computed `import()`s declared closed, by site (`importer`, relative to
   *  the root, and `enclosingFunction`): each loads only what the build's
   *  own literal `import()`s load, an assumption the analysis records. */
  closedDynamicImports?: ClosedDynamicImport[];
  /** The font faces this app preloads, in place of each typed face's own
   *  `preload` flag, so a face declared once for every product preloads only
   *  where the app renders it: family names, or `{ family, weight?, style? }`
   *  (see `FontPreloadEntry`). `[]` preloads none. */
  fontPreloads?: FontPreloadEntry[];
  /**
   * Load third-party stylesheets into `anm-vendor`, a layer below every
   * Animus layer, so their normal rules never beat Animus's. Needs
   * `@animus-ui/layergate` and webpack (`next build --webpack` on Next 16):
   * Turbopack offers no CSS loader boundary for it. `sheets` are delivered
   * with Animus's stylesheet, ahead of it; `dependencies` also covers `.css`
   * your modules import from packages; `optOut` keeps a file's own rules
   * outside the layer. App CSS and CSS Modules are left alone.
   */
  quarantine?: AnimusQuarantineOptions;
}
