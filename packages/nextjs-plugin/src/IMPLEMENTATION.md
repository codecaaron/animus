# Next.js Plugin Implementation Details

## Overview

This implementation follows the two-phase architecture outlined in NEXTJS_REQS.md, splitting the extraction process between TypeScript compilation and webpack bundling.

## Architecture

### Phase 1: TypeScript Transformer (`typescript-transformer.ts`)
- Runs during Next.js TypeScript compilation via `customTransformers`
- Leverages existing `extractFromTypeScriptProject()` to analyze entire codebase
- Builds complete component registry with relationships and cascade ordering
- Generates CSS using existing `generateLayeredCSSFromProject()`
- Caches results to filesystem for Phase 2 consumption

### Phase 2: Webpack Loader (`webpack-loader.ts`)
- Configured with `enforce: 'pre'` to run before Next.js babel-loader
- Reads cached metadata from Phase 1
- Uses existing `transformAnimusCode()` to transform individual modules
- Injects runtime shims with pre-calculated class names
- Preserves source maps and development experience

### Inter-phase Coordination (`cache.ts`)
- Default location: `.next/cache/animus-metadata.json`
- Fallback: `node_modules/.cache/animus/`
- Contains complete registry, metadata, and generated CSS
- Supports memory cache for development hot reloading

## Key Design Decisions

1. **Reuse Existing Logic**: The implementation reuses all core extraction and transformation logic from the Vite plugin, only changing the integration points.

2. **TypeScript Transformer as Side Effect**: The transformer doesn't modify the AST - it only performs extraction and caching as a side effect, returning the source unchanged.

3. **Webpack Loader for Transformation**: Actual code transformation happens in the webpack loader where we have module context and can generate source maps.

4. **Unified Cache Format**: The cache contains everything needed for both transformation and CSS emission, avoiding multiple reads.

5. **Development Experience**: By default, preserves runtime behavior in development for hot reloading while still pre-extracting metadata.

## Implementation Flow

```
1. Next.js starts TypeScript compilation
   ↓
2. TypeScript Transformer runs (once)
   - Extracts all components
   - Generates CSS and metadata
   - Writes to cache
   ↓
3. Webpack bundling begins
   ↓
4. Webpack Loader runs (per module)
   - Reads cache (once)
   - Transforms modules using metadata
   - Injects runtime shims
   ↓
5. Webpack Plugin runs (end of build)
   - Emits CSS file
   - Emits metadata JSON
```

## Cascade Ordering Preservation

The implementation preserves Animus's cascade ordering guarantees:

1. **Extraction Phase**: ComponentRegistry maintains parent-child relationships
2. **CSS Generation**: CSSGenerator performs topological sort for correct ordering
3. **Code Splitting**: Each chunk maintains relative ordering within its styles
4. **Runtime**: Shimmed components use pre-calculated class names

## Compatibility

### App Router (RSC)
- TypeScript transformer runs before RSC compilation
- Generated CSS is static and RSC-compatible
- Metadata available for both server and client components

### Pages Router
- Same extraction and transformation process
- CSS imported in `_app.tsx` or `_document.tsx`
- Full backward compatibility

## Performance Characteristics

- **First Build**: Full analysis (similar to Vite plugin)
- **Incremental Builds**: Cache enables faster rebuilds
- **Development**: Memory cache for instant updates
- **Production**: Zero runtime overhead, pure CSS

## Future Enhancements

1. **Incremental Extraction**: Only re-analyze changed files
2. **Parallel Processing**: Use worker threads for large codebases
3. **Turbopack Support**: Adapt loader for Turbopack when stable
4. **CSS Modules**: Generate scoped class names per module
5. **Critical CSS**: Extract above-the-fold styles