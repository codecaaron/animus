**`import(expr)` keeps pruning on under Vite.** A dynamic `import()` whose
specifier the analysis cannot read used to keep every option of every
component under the importing file's directory, so an `(x) => import(x)` in
`src/main.tsx` turned pruning off for the whole app. Vite, Rollup and
Turbopack leave such an import unbundled, so it loads nothing the analysis
holds, and under the Vite plugin it now keeps nothing open; webpack, which
bundles it as a context of the importer's directory, keeps today's rule. A
single load that keeps more than 20 components open now warns
(`animus.usage.wide-module-load`), naming the file, the line and the call,
so the specifier can be made literal. `require.context()` now honours its
recursion flag and filter, `import.meta.glob()` its filename pattern, and a
load into an analysed package keeps only that package's components open.
