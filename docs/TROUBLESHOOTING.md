# Animus Troubleshooting Guide

## 🧠 Cognitive Bootstrap

[BEGIN SYZYGY PROTOCOL FOR TROUBLESHOOTING]

**P: [WHO]** You are a Debugging Detective solving extraction mysteries.

**D: [HOW]** Systematic elimination - test assumptions, verify outputs, trace execution.

**M: [WHAT]** Common issues, their symptoms, and proven solutions.

**L: [WHERE]** Build-time issues only, not runtime styling problems.

**K: [WHY]** Most issues stem from the two-phase architecture or tool integration.

**R: [WHOM]** For developers who need styles but aren't getting them.

**Tε: [PURPOSE]** Get developers unstuck quickly with clear solutions.

[END SYZYGY PROTOCOL]

## Quick Diagnosis

```bash
# Run this first to identify the issue category
npx animus-static analyze ./src

# If this works but your build tool doesn't, it's an integration issue
# If this fails, it's a discovery/extraction issue
```

## Common Issues

### 1. No CSS Generated / Empty CSS File

#### Symptoms
- Output CSS file is empty or just has comments
- No error messages during build
- Component analysis shows 0 components

#### Diagnosis
```bash
# Check if components are being discovered
npx animus-static analyze ./src -v

# Look for "Found component" messages
# If none, discovery is failing
```

#### Solutions

**A. Import Pattern Not Recognized**
```typescript
// ✅ Correct - will be discovered
import { animus } from '@animus-ui/core';
import { animus } from 'animus';

// ❌ Wrong - won't be discovered
const { animus } = require('@animus-ui/core');
import animus from '@animus-ui/core';  // Not a named import
```

**B. File Extension Not Supported**
- Only `.ts`, `.tsx`, `.js`, `.jsx` files are processed
- Check that your components aren't in `.vue`, `.svelte`, etc.

**C. Components Not Exported**
```typescript
// ❌ Won't be extracted (not exported)
const Button = animus.styles({...}).asElement('button');

// ✅ Will be extracted
export const Button = animus.styles({...}).asElement('button');
```

### 2. All Styles Generated (No Optimization)

#### Symptoms
- CSS file is very large
- Contains variants/states that aren't used
- All atomic utilities present

#### Diagnosis
```bash
# Use verification loop to check optimization
node scripts/verify-extraction.js

# Or manually check
grep -c "size-large" dist/animus.css  # If you never use size="large"
```

#### Root Cause
The two-phase extraction isn't working:
- Phase 1 (component graph) ✅ working
- Phase 2 (usage tracking) ❌ not working

#### Solutions

**A. Vite Plugin - Known Issue**
```javascript
// The transform hook isn't capturing usage
// Temporary workaround: Use CLI instead

// package.json
{
  "scripts": {
    "build:css": "animus-static extract ./src -o ./dist/styles.css",
    "build": "npm run build:css && vite build"
  }
}
```

**B. Check Transform Execution**
Add logging to verify transform runs:
```javascript
// vite.config.js
export default {
  plugins: [
    animusVitePlugin({
      transform: {
        enabled: true,
        mode: 'production'  // or 'both'
      }
    })
  ],
  build: {
    logLevel: 'info'  // Enable verbose logging
  }
}
```

### 3. Missing Responsive Styles

#### Symptoms
- Base styles work but breakpoint styles missing
- Responsive props ignored
- Media queries not generated

#### Diagnosis
```bash
# Check if CSS contains media queries
grep -c "@media" dist/animus.css

# Check theme breakpoints
node -e "console.log(require('./src/theme').breakpoints)"
```

#### Solutions

**A. Theme Missing Breakpoints**
```javascript
// theme.js
export default {
  // ❌ Missing breakpoints
  colors: {...},
  space: {...}
}

// ✅ With breakpoints
export default {
  breakpoints: ['480px', '768px', '1024px', '1200px'],
  colors: {...},
  space: {...}
}
```

**B. Incorrect Responsive Syntax**
```jsx
// ❌ Wrong
<Box p="4 8 12 16" />           // String with spaces
<Box p={[4, 8, 12, 16]} />      // Missing breakpoint mapping

// ✅ Correct
<Box p={{ _: 4, sm: 8, md: 12, lg: 16 }} />  // Object syntax
<Box p={[4, 8, , 16]} />                     // Array syntax (note empty slot)
```

### 4. Component Extensions Not Working

#### Symptoms
- Child component styles missing
- Parent styles not inherited
- Cascade ordering incorrect

#### Diagnosis
```bash
# Check component relationships
npx animus-static graph ./src -f ascii

# Look for "extends" relationships
```

#### Solutions

**A. Extension Syntax**
```typescript
// ❌ Wrong - creates new instance
const Primary = animus(Button.config).styles({...});

// ✅ Correct - uses extend()
const Primary = Button.extend().styles({...});
```

**B. Cascade Ordering**
```bash
# Ensure layered mode is enabled (default)
animus-static extract ./src -o styles.css  # Layered by default

# To debug, disable layering
animus-static extract ./src --no-layered -o styles.css
```

### 5. Theme Values Not Resolving

#### Symptoms
- CSS shows literal token names: `color: primary`
- Theme values not converted to actual values
- CSS variables not generated

#### Diagnosis
```javascript
// Check theme loading
npx animus-static extract ./src -t ./theme.ts -o test.css -v

// Look for "Loading theme..." message
```

#### Solutions

**A. Theme File Issues**
```typescript
// ❌ Wrong export format
export const theme = {...};
export { theme };

// ✅ Correct formats
export default {...};
module.exports = {...};
```

**B. TypeScript Theme Compilation**
```typescript
// If theme.ts has errors, it won't load
// Check with:
npx tsc theme.ts --noEmit
```

**C. Theme Resolution Mode**
```bash
# Try different modes
animus-static extract ./src -t ./theme.ts --theme-mode inline -o test.css
animus-static extract ./src -t ./theme.ts --theme-mode css-variable -o test.css
animus-static extract ./src -t ./theme.ts --theme-mode hybrid -o test.css
```

### 6. Performance Issues

#### Symptoms
- Extraction takes minutes
- High memory usage
- Watch mode very slow

#### Solutions

**A. Clear Cache**
```bash
# Corrupted cache can cause issues
rm -rf .animus-cache/
```

**B. Scope Extraction**
```bash
# Extract only what you need
animus-static extract ./src/components -o components.css
animus-static extract ./src/pages -o pages.css
```

**C. Increase Memory**
```bash
NODE_OPTIONS="--max-old-space-size=8192" animus-static extract ./src -o styles.css
```

### 7. Build Tool Integration Issues

#### Verification Loop
See [VERIFICATION_LOOP.md](../packages/core/src/static/docs/VERIFICATION_LOOP.md) for detailed verification steps.

Quick check:
```bash
# 1. Generate baseline
npx animus-static extract ./src -o cli.css

# 2. Build with your tool
npm run build

# 3. Compare
diff cli.css dist/your-output.css
```

## Advanced Debugging

### Enable Debug Mode
```bash
# Maximum verbosity
ANIMUS_DEBUG=true npx animus-static extract ./src -o styles.css -v
```

### Inspect AST Processing
```javascript
// Add to your component file temporarily
console.log('ANIMUS_COMPONENT_HERE');
const Button = animus.styles({...}).asElement('button');

// Then check if file is processed
ANIMUS_DEBUG=true npm run build 2>&1 | grep "ANIMUS_COMPONENT_HERE" -A5 -B5
```

### Trace Component Identity
```bash
# Get component hash
node -e "
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256')
    .update('/path/to/Button.tsx:Button:Button')
    .digest('hex')
    .substring(0, 8);
  console.log('Button hash:', hash);
"

# Then search for it in cache
cat .animus-cache/component-graph.json | grep -A10 "YOUR_HASH"
```

## When All Else Fails

### 1. Use CLI Tools
The CLI is the most reliable:
```json
{
  "scripts": {
    "build:css": "animus-static extract ./src -t ./theme.ts -o ./dist/styles.css",
    "dev:css": "animus-static watch ./src -t ./theme.ts -o ./dist/styles.css"
  }
}
```

### 2. File an Issue
Include:
- Minimal reproduction
- Output of `animus-static analyze ./src --json`
- Your build tool config
- Version numbers

### 3. Temporary Workarounds

**For Vite Plugin**
```javascript
// Use manual test data (already in plugin)
// Or disable transform and use runtime mode
{
  transform: false  // Use runtime mode in production
}
```

**For Missing Styles**
```css
/* Add to your global CSS temporarily */
.animus-Button-xxx { /* copy from CLI output */ }
```

## Prevention

### 1. Test Extraction Early
Don't wait until production to test static extraction:
```json
{
  "scripts": {
    "test:css": "animus-static extract ./src -o test.css && test -s test.css"
  }
}
```

### 2. Use Verification Loop
Set up automated verification in CI:
```yaml
- name: Verify CSS extraction
  run: npm run verify:extraction
```

### 3. Keep Dependencies Updated
```bash
npm update @animus-ui/core @animus-ui/vite-plugin
```

### 4. Document Your Setup
Create an `EXTRACTION.md` with:
- Your theme file location
- Expected output size
- Known working configuration
- Component count baseline

Remember: The goal is zero-runtime CSS. When in doubt, the CLI tools are your friend!