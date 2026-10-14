/** The session's font-preloads module, aliased by `withAnimus`. */
declare module 'virtual:animus/font-preloads' {
  const preloads: ReadonlyArray<{ href: string; type?: string }>;
  export default preloads;
}
