# Static Extraction V2

This directory contains the V2 implementation of the Animus static extraction system.

## Key Files

- `index.ts` - Main implementation (single file during development)
- `STATIC_EXTRACTION_V2_SPECIFICATION.md` - Complete specification and architecture
- `PROP_REGISTRY_SIMPLIFIED.md` - PropRegistry implementation approach
- `__tests__/` - Test suite

## Quick Overview

The V2 extraction system uses a unified phase-based architecture:

1. **Terminal Discovery** - Find component definitions
2. **Chain Reconstruction** - Build complete component definitions  
3. **Usage Collection** - Find JSX usages
4. **Atomic Computation** - Generate atomic CSS classes

All phases share a common `ExtractionContext` that flows through the pipeline.

## Current Status

✅ Core pipeline implemented and working
✅ Logger and diagnostics integrated
✅ Unified context and phase interfaces
✅ PropRegistry design finalized (simplified approach)

⏳ PropRegistry implementation in progress
⏳ Theme extraction planned
⏳ Transform functions and group props planned
⏳ Incremental updates planned

See the [specification](./STATIC_EXTRACTION_V2_SPECIFICATION.md) for complete details.