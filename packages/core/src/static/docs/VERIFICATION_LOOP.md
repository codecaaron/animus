# Verification Loop: Testing Downstream Tool Parity

## 🧠 Cognitive Bootstrap

[BEGIN SYZYGY PROTOCOL FOR VERIFICATION]

**P: [WHO]** You are a Quality Assurance Architect ensuring tool parity.

**D: [HOW]** Create feedback loops between CLI (source of truth) and downstream tools.

**M: [WHAT]** Verification workflows that catch integration failures early.

**L: [WHERE]** CLI as baseline, build tools as subjects under test.

**K: [WHY]** The CLI works correctly; use it to verify other integrations.

**R: [WHOM]** For developers debugging why their build tool isn't extracting properly.

**Tε: [PURPOSE]** Establish clear verification patterns for tool parity.

[END SYZYGY PROTOCOL]

## Overview

Since the CLI tools are the most reliable implementation of static extraction, we can use them as a baseline to verify that downstream tools (Vite plugin, webpack loaders, etc.) produce equivalent output.

## The Verification Loop

```
┌─────────────────────────────────────────────────────┐
│                 Verification Loop                    │
├─────────────────────────────────────────────────────┤
│                                                      │
│  1. CLI Extraction (Baseline)                        │
│     └─> animus.cli.css                              │
│                                                      │
│  2. Build Tool Extraction (Test Subject)             │
│     └─> animus.vite.css                             │
│                                                      │
│  3. Compare Outputs                                  │
│     ├─> Component Coverage                           │
│     ├─> CSS Differences                              │
│     └─> Usage Tracking                               │
│                                                      │
│  4. Debug Discrepancies                              │
│     └─> Identify integration issues                  │
│                                                      │
└─────────────────────────────────────────────────────┘
```

## Step-by-Step Verification

### 1. Generate CLI Baseline

First, create the reference output using CLI tools:

```bash
# Extract with CLI (our source of truth)
animus-static extract ./src -t ./src/theme.ts -o ./dist/animus.cli.css

# Analyze what was extracted
animus-static analyze ./src --json > ./dist/analysis.cli.json

# Generate component graph
animus-static graph ./src -o ./dist/graph.cli.json
```

### 2. Generate Build Tool Output

Run your build tool (e.g., Vite) to generate its version:

```bash
# Build with Vite plugin
npm run build

# Output should be at ./dist/animus.css (or configured location)
```

### 3. Compare Outputs

#### A. Quick Visual Diff

```bash
# Compare file sizes (should be similar)
ls -la dist/animus.*.css

# Visual diff
diff dist/animus.cli.css dist/animus.css

# Or with a better diff tool
code --diff dist/animus.cli.css dist/animus.css
```

#### B. Structured Comparison Script

Create a verification script:

```javascript
// verify-extraction.js
const fs = require('fs');

function parseCSS(cssContent) {
  const components = new Set();
  const variants = new Set();
  const states = new Set();
  const atomics = new Set();
  
  // Extract class names
  const classRegex = /\.animus-(\w+)-[\w\d]+/g;
  const variantRegex = /\.animus-\w+-[\w\d]+-(\w+)-(\w+)/g;
  const stateRegex = /\.animus-\w+-[\w\d]+-state-(\w+)/g;
  const atomicRegex = /\.([\w-]+)-[\d\w]+/g;
  
  let match;
  while (match = classRegex.exec(cssContent)) {
    components.add(match[1]);
  }
  
  // Reset regex
  cssContent.match(variantRegex)?.forEach(m => variants.add(m));
  cssContent.match(stateRegex)?.forEach(m => states.add(m));
  cssContent.match(atomicRegex)?.forEach(m => atomics.add(m));
  
  return { components, variants, states, atomics };
}

// Load both CSS files
const cliCSS = fs.readFileSync('./dist/animus.cli.css', 'utf8');
const viteCSS = fs.readFileSync('./dist/animus.css', 'utf8');

// Parse both
const cliParsed = parseCSS(cliCSS);
const viteParsed = parseCSS(viteCSS);

// Compare
console.log('=== Component Coverage ===');
console.log(`CLI:  ${cliParsed.components.size} components`);
console.log(`Vite: ${viteParsed.components.size} components`);

// Find differences
const missingInVite = [...cliParsed.components].filter(c => !viteParsed.components.has(c));
const extraInVite = [...viteParsed.components].filter(c => !cliParsed.components.has(c));

if (missingInVite.length) {
  console.log('\n❌ Missing in Vite:', missingInVite);
}
if (extraInVite.length) {
  console.log('\n⚠️  Extra in Vite:', extraInVite);
}

console.log('\n=== CSS Size Comparison ===');
console.log(`CLI:  ${(cliCSS.length / 1024).toFixed(2)}KB`);
console.log(`Vite: ${(viteCSS.length / 1024).toFixed(2)}KB`);

// Check for usage optimization
const hasUsageOptimization = viteCSS.length < cliCSS.length * 0.8;
console.log(`\n=== Usage Optimization ===`);
console.log(`Working: ${hasUsageOptimization ? '✅ Yes' : '❌ No'}`);
```

### 4. Verify Component Graph

Compare the component graphs to ensure discovery is working:

```bash
# Compare graph structures
node -e "
  const cliGraph = require('./dist/graph.cli.json');
  const viteGraph = require('./.animus-cache/component-graph.json');
  
  console.log('CLI components:', cliGraph.metadata.totalComponents);
  console.log('Vite components:', viteGraph.metadata.totalComponents);
  
  // Check if same components discovered
  const cliComps = [...cliGraph.components.keys()].sort();
  const viteComps = [...viteGraph.components.keys()].sort();
  
  console.log('Discovery match:', 
    JSON.stringify(cliComps) === JSON.stringify(viteComps) ? '✅' : '❌'
  );
"
```

### 5. Usage Tracking Verification

Create a test case to verify usage tracking:

```typescript
// test-usage.tsx
import { Button } from './Button';
import { Card } from './Card';

export function TestUsage() {
  return (
    <Card>
      {/* This specific usage should be tracked */}
      <Button size="small" disabled>
        Test
      </Button>
    </Card>
  );
}
```

Then verify the output includes ONLY:
- `Button` component base styles
- `size="small"` variant styles
- `disabled` state styles
- `Card` component base styles

```bash
# Check if specific classes exist
grep -c "animus-Button.*-size-small" dist/animus.css
grep -c "animus-Button.*-state-disabled" dist/animus.css

# These should NOT exist if usage tracking works
grep -c "animus-Button.*-size-large" dist/animus.css  # Should be 0
grep -c "animus-Button.*-size-medium" dist/animus.css # Should be 0
```

## Automated Verification Script

Create a comprehensive verification script:

```json
// package.json
{
  "scripts": {
    "verify:extraction": "node scripts/verify-extraction.js",
    "build:verify": "npm run build && npm run verify:extraction"
  }
}
```

```javascript
// scripts/verify-extraction.js
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🔍 Animus Extraction Verification\n');

// Step 1: Generate CLI baseline
console.log('1️⃣  Generating CLI baseline...');
execSync('animus-static extract ./src -t ./src/theme.ts -o ./dist/animus.cli.css', { 
  stdio: 'inherit' 
});

// Step 2: Ensure Vite build ran
if (!fs.existsSync('./dist/animus.css')) {
  console.error('❌ Vite output not found. Run build first.');
  process.exit(1);
}

// Step 3: Compare outputs
console.log('\n2️⃣  Comparing outputs...');

const cliSize = fs.statSync('./dist/animus.cli.css').size;
const viteSize = fs.statSync('./dist/animus.css').size;

console.log(`CLI:  ${(cliSize / 1024).toFixed(2)}KB`);
console.log(`Vite: ${(viteSize / 1024).toFixed(2)}KB`);

// Size difference threshold
const sizeDiff = Math.abs(cliSize - viteSize) / cliSize;
if (sizeDiff > 0.1) {
  console.log(`\n⚠️  Size difference: ${(sizeDiff * 100).toFixed(1)}%`);
  
  if (viteSize > cliSize * 1.5) {
    console.log('❌ Vite output is significantly larger - usage tracking likely broken');
  }
}

// Step 4: Check for specific patterns
console.log('\n3️⃣  Checking extraction patterns...');

const viteCSS = fs.readFileSync('./dist/animus.css', 'utf8');

// Check for component base styles
const hasBaseStyles = viteCSS.includes('.animus-Button-');
const hasVariants = viteCSS.includes('-size-');
const hasStates = viteCSS.includes('-state-');
const hasAtomics = /\.[a-z]+-\d+/.test(viteCSS);

console.log(`Base styles: ${hasBaseStyles ? '✅' : '❌'}`);
console.log(`Variants:    ${hasVariants ? '✅' : '❌'}`);
console.log(`States:      ${hasStates ? '✅' : '❌'}`);
console.log(`Atomics:     ${hasAtomics ? '✅' : '❌'}`);

// Step 5: Usage optimization check
console.log('\n4️⃣  Checking usage optimization...');

// Count total variant classes
const allVariants = (viteCSS.match(/-size-\w+/g) || []).length;
const allStates = (viteCSS.match(/-state-\w+/g) || []).length;

console.log(`Total variants: ${allVariants}`);
console.log(`Total states: ${allStates}`);

if (allVariants > 10 || allStates > 10) {
  console.log('⚠️  Many variants/states present - usage tracking may not be working');
}

// Final verdict
console.log('\n📊 Verification Summary:');
const issues = [];

if (sizeDiff > 0.3) issues.push('Large size difference');
if (!hasBaseStyles) issues.push('Missing base styles');
if (allVariants > 10) issues.push('Too many variants (no usage filtering)');

if (issues.length === 0) {
  console.log('✅ Extraction appears to be working correctly!');
} else {
  console.log('❌ Issues detected:');
  issues.forEach(issue => console.log(`  - ${issue}`));
  
  console.log('\n💡 Debug suggestions:');
  console.log('  1. Check if transform hook is running (add console.log)');
  console.log('  2. Verify component graph is available during transform');
  console.log('  3. Check usage tracker is collecting data');
  console.log('  4. Use CLI tools for production: npm run build:css');
}
```

## CI Integration

Add verification to your CI pipeline:

```yaml
# .github/workflows/verify-extraction.yml
name: Verify Extraction Parity

on: [push, pull_request]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Install dependencies
        run: npm ci
        
      - name: Build with Vite
        run: npm run build
        
      - name: Verify extraction parity
        run: npm run verify:extraction
        
      - name: Upload diff if failed
        if: failure()
        uses: actions/upload-artifact@v3
        with:
          name: extraction-diff
          path: |
            dist/animus.cli.css
            dist/animus.css
            dist/analysis.*.json
```

## Debugging When Verification Fails

### 1. Check Component Discovery

```bash
# Compare what components were found
diff <(animus-static analyze ./src --json | jq 'keys[]' | sort) \
     <(cat .animus-cache/component-graph.json | jq '.components | keys[]' | sort)
```

### 2. Trace Transform Execution

Add logging to build tool:

```javascript
// In vite plugin transform hook
console.log('[Transform]', id, {
  hasGraph: !!componentGraph,
  hasTracker: !!usageTracker,
  willTransform: shouldTransform
});
```

### 3. Inspect Usage Data

```javascript
// In generateBundle hook
console.log('[Usage Data]', {
  components: usageSet.components.size,
  totalProps: Array.from(usageSet.components.values())
    .reduce((sum, u) => sum + u.props.size, 0)
});
```

### 4. Manual Test Case

Create minimal test case:

```typescript
// minimal-test.tsx
import { animus } from '@animus-ui/core';

const TestComponent = animus
  .styles({ padding: '20px' })
  .variant({
    prop: 'test',
    variants: {
      a: { color: 'red' },
      b: { color: 'blue' }
    }
  })
  .asElement('div');

// Only use variant 'a'
export const Test = () => <TestComponent test="a">Test</TestComponent>;
```

Expected: Only variant 'a' styles generated
Reality: Check if both 'a' and 'b' are in output

## Summary

This verification loop provides:
1. **Objective baseline** - CLI output as source of truth
2. **Automated comparison** - Scripts to detect discrepancies
3. **Clear diagnostics** - Specific checks for common issues
4. **Actionable feedback** - Debug suggestions when verification fails

Use this loop whenever:
- Implementing new build tool integrations
- Debugging extraction issues
- Verifying usage optimization is working
- Ensuring parity across tools