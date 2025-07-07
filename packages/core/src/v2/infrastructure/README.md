# Infrastructure

Core system services and utilities that support the static extraction process.

## Contents

- **cache.ts** - Caching infrastructure for extraction results
- **diagnostics.ts** - Diagnostics collection and reporting
- **errors.ts** - Error handling and classification
- **logger.ts** - Logging infrastructure with scoped loggers
- **performance.ts** - Performance monitoring and profiling

## Usage

These modules provide foundational services used throughout the extraction pipeline:

```typescript
import { ConsoleLogger } from './infrastructure/logger';
import { MemoryCacheManager } from './infrastructure/cache';
import { PerformanceMonitorImpl } from './infrastructure/performance';
```

All infrastructure modules follow consistent interfaces to ensure they can be easily replaced with alternative implementations if needed.