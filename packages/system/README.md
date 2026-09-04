# @animus-ui/system

Type-driven design system builder with static extraction. Zero runtime.

## Install

```bash
npm install @animus-ui/system
```

Pair with an extraction driver: `@animus-ui/vite-plugin`,
`@animus-ui/next-plugin`, `@animus-ui/unplugin`, or the `@animus-ui/cli`.

## Documentation

Deliberately withheld. The system-definition API is still settling
(vocabulary registration: `build()` → register → `seal()`), and written
guides repeatedly drifted into teaching shapes the current pipeline
rejects. Rather than keep wrong docs, they are removed until the API
freezes. Until then, the sources of truth are:

- this package's TypeScript definitions — the types are the contract;
- the in-repo consumers of the animus monorepo, which are compiled,
  extracted, and asserted on every verify run and therefore cannot
  silently drift: `packages/test-ds/src/system.ts` (a kit),
  the `e2e/*/src/ds.ts` apps, and `packages/showcase/src/ds.ts`.

## License

MIT
