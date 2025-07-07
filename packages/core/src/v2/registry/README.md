# Registry

PropRegistry extraction and configuration for Animus style props.

## Contents

- **propRegistryExtractor.ts** - Extracts PropRegistry from Animus instances using TypeScript's type system
- **defaultRegistry.ts** - (To be extracted) Default prop definitions for common CSS properties

## Overview

The PropRegistry defines which props are recognized as style props and how they map to CSS properties. It supports:

- Single CSS property mapping (e.g., `color` → `color`)
- Multiple CSS property mapping (e.g., `mx` → `marginLeft`, `marginRight`)
- Theme scale resolution (e.g., `space`, `colors`, `fontSizes`)
- Transform functions (deprecated but supported for compatibility)

## Type-Based Extraction

The `TypeBasedPropRegistryExtractor` analyzes TypeScript types to extract prop definitions from Animus instances, enabling static extraction to understand custom prop configurations without runtime execution.