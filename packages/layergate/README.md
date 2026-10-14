# @animus-ui/layergate

Load third-party stylesheets into a cascade layer, so their normal rules
never beat yours, whatever their specificity or load order.

A stylesheet outside any `@layer` beats every layered rule. A date picker's
or grid library's CSS imported as usual therefore overrides a design
system or utility framework that uses layers. layergate loads that CSS
itself, inlines its `@import`s, and puts each file's own rules in one layer
below yours:

```css
@layer vendor, app;
@layer vendor {
  /* react-grid-layout/css/styles.css, as written */
}
```

## Vite

```ts
import { layergate } from '@animus-ui/layergate/vite';
// vite.config.ts
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    layergate({
      layer: 'vendor',
      order: ['vendor', 'base', 'components', 'utilities'],
      sheets: ['react-grid-layout/css/styles.css', './styles/legacy.css'],
      dependencies: ['react-datepicker'],
      optOut: ['./styles/legacy/keep-unlayered.css'],
    }),
  ],
});
```

```ts
// your entry module, once, before other CSS
import 'virtual:layergate';
```

| Option         | Meaning                                                                                                                                                    |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `layer`        | The layer owned stylesheets go into. Default `vendor`.                                                                                                     |
| `order`        | The full layer order every owned stylesheet declares first. It must include `layer`. Default `[layer]`.                                                    |
| `sheets`       | Stylesheets `virtual:layergate` delivers, in this order, whether or not anything else imports them: package specifiers or paths relative to the Vite root. |
| `dependencies` | Also own the `.css` a JS module imports from a package other than your app: `true` for every package, or package names. Default: none.                     |
| `optOut`       | Files inside an owned stylesheet whose own rules stay outside the layer. Exact specifiers or paths, never globs.                                           |

A JS module's import of an owned stylesheet, by any spelling, gets the same
single copy, and the declared sheets always come first, in their declared
order, whichever owned stylesheet the app imports first. Vite's own CSS
pipeline then processes each one once: PostCSS, minification, injection and
extraction. A nested `@import` of a package resolves as a CSS import does,
through its `style` entry. Fonts and images keep resolving, because
layergate rewrites a relative `url()` to resolve from the delivered file.
Edits to an owned file, nested imports and files under `node_modules`
included, hot-update in place.

## What it does to a stylesheet

- **Each file is decided on its own.** A file's own rules go into the
  layer. An opted-out file's own rules stay outside it, under the
  conditions of the `@import` that loads it, and the files it imports keep
  their own decisions.
- **Imports keep their conditions.** `@import "x.css" layer(a) supports(…)
  screen` becomes `@media screen { @supports (…) { @layer a { … } } }`
  inside the layer, so its rules land in `vendor.a`. An anonymous `layer`
  import gets a private layer of its own, never the shared one.
- **Text is kept as written.** Selectors, declarations, `!important`,
  keyframes and the file's own layers reach the browser unchanged. Only a
  relative `url()` in a file outside the delivered file's directory changes.
- **Remote imports stay remote.** An `http(s):` import is hoisted to the
  top, in its layer, and reported, since its contents are not inspected.

## What a layer does not change

A layer bounds normal declarations only. These are kept and reported as
warnings, never stripped:

- `!important` declarations, which beat your normal declarations from any
  layer (`layergate.important`);
- animations and keyframes, whose values override normal declarations
  while they run (`layergate.animation`).

Font, keyframe and property names are global, whatever their layer.

## Not yet

- CSS Modules, Sass, Less and Stylus are left to Vite.
- An owned file can arrive more than once. A stylesheet Vite loads
  itself, such as an app sheet whose `@import` reaches an owned file, is
  finished by layergate too: its own rules stay unlayered and the owned
  file is inlined layered, so no unlayered copy escapes. But each finished
  stylesheet stands on its own, so the same owned file reached from two of
  them is delivered in both, each copy layered. One delivery per file
  across the document would need a document-wide registry, a possible
  later increment.
- App CSS is left alone unless you list it in `sheets`. CSS that loads
  before `virtual:layergate`, or another tool's layer order statement that
  comes first, can still place your layers after `vendor`.
- A `.css` request with a query (`?inline`, `?url`, `?raw`) is left to Vite.
- A stylesheet with `@namespace` is an error (`layergate.namespace`): it
  applies to a whole stylesheet, which a file inlined into another is not.
- A host's PostCSS runs once, over each finished stylesheet, not per file.
- Vite only, for now. webpack and Next come next; Turbopack after.

## Delivering from a host stylesheet

A tool with its own stylesheet module can deliver the declared sheets at
its head instead of through `virtual:layergate`: pass `declaredBy` (the
module's specifier, which an owned stylesheet a JS module imports then
loads first), and prepend `await plugin.stylesheetHead.call(this, id)` to
that module's CSS in its `load` hook. The head uses root-relative URLs, so
assets resolve from a virtual module too; a file outside the Vite root is
reached through `/@fs/`: in development a declared sheet's directory is
added to `server.fs.allow` when the server starts (beside your own list, or
Vite's default workspace root), and an asset it references in another
directory is allowed when it is found; in a build it is emitted as an
asset. Animus's `quarantine`
option works this way.

## Core API

`compileUnit(roots, { layer, order, resolve, read, quarantined, owns, url, base, cache })`
compiles stylesheet graphs, in order, into one finished stylesheet with the
host's resolver and file reader, and returns the CSS, a source map, the files
read, whether anything was layered, and the diagnostics. `owns` says which
files start an owned graph (default: all), and `url` maps a referenced file
to its URL text (default: relative to the first root).
`base` is the directory generated layer names are relative to (the project
root), so they are the same on every machine. `cache` keeps parsed files
between compiles; drop a file's entry when it changes. The Vite adapter is built on it.
