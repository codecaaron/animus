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
- An app stylesheet's own `@import` of an owned file is inlined by Vite
  itself, which never asks plugins, so that copy stays unlayered. Import
  owned stylesheets from JS, or list them in `sheets`.
- Each owned stylesheet is finished on its own: a file two of them import
  appears in both.
- App CSS is left alone unless you list it in `sheets`. CSS that loads
  before `virtual:layergate`, or another tool's layer order statement that
  comes first, can still place your layers after `vendor`.
- A `.css` request with a query (`?inline`, `?url`, `?raw`) is left to Vite.
- A stylesheet with `@namespace` is an error (`layergate.namespace`): it
  applies to a whole stylesheet, which a file inlined into another is not.
- A host's PostCSS runs once, over each finished stylesheet, not per file.
- Vite only, for now. webpack and Next come next; Turbopack after.

## Core API

`compileUnit(root, { layer, order, resolve, read, quarantined, base, cache })`
compiles one stylesheet graph with the host's resolver and file reader, and
returns the finished CSS, a source map, the files read and the diagnostics.
`base` is the directory generated layer names are relative to (the project
root), so they are the same on every machine. `cache` keeps parsed files
between compiles; drop a file's entry when it changes. The Vite adapter is built on it.
