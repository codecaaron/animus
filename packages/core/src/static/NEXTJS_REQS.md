Two-Phase Static Extraction Architecture for Next.js
Phase 1: Global Analysis (TypeScript Compilation)
Integration Point: next.config.js → typescript.customTransformers.before[]
Responsibilities:

Traverse entire codebase before modularization
Build complete component relationship graph
Establish inheritance hierarchies
Calculate deterministic ordering
Collect usage patterns across all files
Generate global metadata structure

Output: Serializable graph containing:

Component definitions with unique identifiers
Parent-child relationships
Cross-file dependencies
Usage locations and patterns
Cascade ordering prerequisites

Phase 2: Module Transformation (Webpack Build)
Integration Point: next.config.js → webpack() → config.module.rules
Responsibilities:

Transform individual modules using global graph
Generate deterministic identifiers from metadata
Inject runtime adapters for each component
Preserve original source mappings
Connect compile-time analysis to runtime behavior

Output: Transformed modules with:

Statically generated identifiers
Runtime shim connections
Preserved type information
Cascade position metadata

Next.js Specific Integration Points
javascript// next.config.js
module.exports = {
  // Phase 1 Entry Point
  typescript: {
    customTransformers: {
      before: [/* TS transformer plugin */],
      after: [],
      afterDeclarations: []
    }
  },

  // Phase 2 Entry Point
  webpack(config, { buildId, dev, isServer, defaultLoaders, webpack }) {
    // Prepend to rules array (before Next.js babel-loader)
    config.module.rules.unshift({
      test: /\.(tsx?|jsx?)$/,
      enforce: 'pre',
      use: [/* Custom loader */]
    });

    // Optional: Add webpack plugin for coordination
    config.plugins.push(/* Custom webpack plugin */);

    return config;
  }
}
Information Flow

TypeScript Phase runs via Next.js's TypeScript compiler
Graph persists in webpack's filesystem cache or memory
Webpack Phase consumes graph during module processing
Each module receives only its relevant subgraph
Runtime receives pre-calculated cascade positions

Next.js Considerations

App Router vs Pages Router: Different entry points but same transformation
Server vs Client: Graph built once, used by both
Development vs Production: Same pipeline, different optimizations
Turbopack: Future migration path through loader API compatibility

Webpack-Specific Hooks

compiler.hooks.beforeCompile: Load/verify global graph
compiler.hooks.compilation: Register virtual modules
compiler.hooks.done: Emit debug artifacts
NormalModuleFactory.hooks.resolve: Intercept module resolution
compilation.hooks.optimizeChunkAssets: Final CSS optimization

This architecture ensures complete visibility during TypeScript analysis while maintaining efficient per-module transformation through webpack's loader pipeline.
