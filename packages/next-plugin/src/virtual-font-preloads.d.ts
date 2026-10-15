/** The session's font-preloads module, aliased by `withAnimus`. */
declare module 'virtual:animus/font-preloads' {
  const preloads: ReadonlyArray<
    import('@animus-ui/extract/pipeline').FontPreload
  >;
  export default preloads;
}
