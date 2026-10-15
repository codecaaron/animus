// The modules @animus-ui/vite-plugin serves to app code. Reference them with
// `/// <reference types="@animus-ui/vite-plugin/client" />`, or with
// `"types": ["@animus-ui/vite-plugin/client"]` in tsconfig.json. Free of the
// plugin's own (Node) types, so a browser tsconfig needs nothing more.

/** Animus's stylesheet: import it once, from the app's entry. */
declare module 'virtual:animus/styles.css' {}

/** Each font file this build preloads, at the URL index.html preloads it,
 *  with the faces that preload it. */
declare module 'virtual:animus/font-preloads' {
  /** A face that preloads a file: its family, as `fontPreloads` matches
   *  it, and the descriptors it declares. */
  interface PreloadedFontFace {
    family: string;
    weight?: string;
    style?: string;
    unicodeRange?: string;
  }
  /** A preloaded font file: the plugin's `FontPreload`. */
  interface FontPreload {
    href: string;
    /** The file's MIME type, where its format names a known one. */
    type?: string;
    faces?: PreloadedFontFace[];
    /** The `fetchpriority` the `fontPreloads` option gives it. */
    fetchpriority?: 'high' | 'low' | 'auto';
  }
  const preloads: ReadonlyArray<FontPreload>;
  export default preloads;
}
