**Font faces can preload.** A typed font face declared with `preload: true`
starts loading before the stylesheet's `@font-face` applies. It preloads its
first `url` source in WOFF2, or else its first `url` source, which must be an
`asset()` file or a root-relative or absolute URL. The `<link rel="preload"
as="font" crossorigin>` names the URL the stylesheet's own `url()` loads,
hashed in a build and the dev server's in development, so the browser fetches
the file once. A file on another origin also gets a `preconnect`. Vite
injects the links into `index.html`. Next renders them through
`AnimusFontPreloads` (App Router root layout) or `AnimusFontPreloadLinks`
(`pages/_document`), from `@animus-ui/next-plugin/font-preloads`. Rollup,
webpack and esbuild emit `animus-font-preloads.json` beside `animus.css`, and
the CLI publishes `font-preloads.json`, each only when a face preloads.
`renderFontPreloads` turns either into the tags. In Vite development, an
`asset()` file inside the root is now served at its root-relative URL, the
one Vite's own stylesheet pipeline gives it, so component CSS and global CSS
name one URL for it. A preload that cannot be honoured warns
(`animus.style.font-face-preload-dropped`), and the face is still emitted.
