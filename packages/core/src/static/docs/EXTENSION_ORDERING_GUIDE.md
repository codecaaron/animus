# Extension-Aware CSS Cascade Ordering

## Overview

The Animus static extraction system now respects component extension hierarchy when generating CSS. This ensures that child components created with `.extend()` always override their parent components through proper cascade ordering.

## How It Works

### 1. Extension Tracking
The system tracks component relationships through:
- `ExtractedStylesWithIdentity.extends` - identifies parent component
- `ComponentRegistry.buildDependencyGraph()` - builds dependency relationships
- `ComponentRegistry.getComponentsSortedByExtension()` - topological sort by extension hierarchy

### 2. CSS Layer Organization
Generated CSS follows this layer structure:

```css
/* 1. CSS Variables */
:root {
  --animus-colors-primary: #007bff;
}

/* 2. Base Styles (all components, topologically sorted) */
.animus-Button-b6n { padding: 8px 16px; }
.animus-PrimaryButton-p13n { color: white; background: blue; }  /* Child after parent */

/* 3. Variant Styles (all components, preserving order) */
.animus-Button-b6n-size-small { padding: 4px 8px; }
.animus-PrimaryButton-p13n-size-small { font-weight: bold; }  /* Child after parent */

/* 4. State Styles (all components) */
.animus-Button-b6n-state-disabled { opacity: 0.6; }

/* 5. Atomic Utilities */
.animus-p-1 { padding: 4px; }
```

### 3. Topological Sorting
The system uses depth-first search to ensure parents always come before children:

```
Button → PrimaryButton → LargePrimaryButton
  ↓         ↓               ↓
 CSS1     CSS2           CSS3
```

## Usage Examples

### Basic Extension
```typescript
const Button = animus
  .styles({ padding: '8px 16px', backgroundColor: 'white' })
  .asElement('button');

const PrimaryButton = Button.extend()
  .styles({ backgroundColor: 'blue', color: 'white' })
  .asElement('button');
```

**Generated CSS (correct order):**
```css
.animus-Button-b6n {
  padding: 8px 16px;
  background-color: white;
}

.animus-PrimaryButton-p13n {
  background-color: blue;  /* Overrides parent */
  color: white;
}
```

### Multi-Level Extension
```typescript
const Button = animus
  .styles({ padding: '8px' })
  .asElement('button');

const PrimaryButton = Button.extend()
  .styles({ backgroundColor: 'blue' })
  .asElement('button');

const LargePrimaryButton = PrimaryButton.extend()
  .styles({ fontSize: '18px' })
  .asElement('button');
```

**Generated CSS (proper hierarchy):**
```css
/* Base Styles */
.animus-Button-b6n { padding: 8px; }
.animus-PrimaryButton-p13n { background-color: blue; }
.animus-LargePrimaryButton-l18n { font-size: 18px; }
```

## API Changes

### New Functions
- `CSSGenerator.generateLayeredCSS()` - Main layered generation method
- `ComponentRegistry.getComponentsSortedByExtension()` - Sorted components
- `generateLayeredCSSFromProject()` - High-level project API

### New Types
```typescript
interface LayeredCSS {
  cssVariables: string;
  baseStyles: string;
  variantStyles: string;
  stateStyles: string;
  atomicUtilities: string;
  fullCSS: string;
  usedTokens: Set<string>;
}
```

## Migration Path

### For CLI Users
The system automatically generates properly ordered CSS. No changes needed for basic usage.

### For Programmatic Usage
```typescript
// Old approach (per-component)
const generator = new CSSGenerator();
for (const component of components) {
  const css = generator.generateFromExtracted(component);
}

// New approach (project-wide with proper ordering)
import { generateLayeredCSSFromProject } from '@animus-ui/core/static';

const layeredCSS = await generateLayeredCSSFromProject('./src', {
  theme: myTheme,
  themeResolution: 'hybrid'
});

console.log(layeredCSS.fullCSS); // Properly ordered CSS
```

## Benefits

1. **Predictable Overrides**: Child components always override parents
2. **Cascade-Aware**: Respects CSS cascade specificity rules  
3. **Performance**: Optimal CSS structure for browser parsing
4. **Maintainability**: Clear visual separation of CSS layers
5. **Framework Agnostic**: Works with any styling approach

## Technical Details

### Topological Sort Algorithm
- Uses depth-first search with cycle detection
- Handles circular dependencies gracefully
- Maintains stable sort order for components at same level

### CSS Specificity
- All component selectors have equal specificity (single class)
- Extension ordering determined solely by cascade position
- Variants and states maintain component hierarchy within their layer

### Performance Considerations
- Single pass through component registry
- Efficient dependency graph building
- Minimal memory overhead for sorting

## Testing

The system includes comprehensive tests for:
- Basic parent → child ordering
- Multi-level inheritance chains
- Circular dependency handling
- CSS layer organization

Run tests:
```bash
yarn test packages/core/src/static/__tests__/extension-cascade-ordering.test.ts
```