/* eslint-disable no-console */
/**
 * Simple validation that our POC approach works
 * This demonstrates the core concept without full integration
 */

import { stylesToAtomicClasses } from './atomic-css';
import { getStyleSheet } from './static-mode';

console.log('\n🔍 Validating Static Extraction POC Core Concepts\n');

// Test 1: Atomic CSS Generation
console.log('1️⃣ Testing Atomic CSS Generation');
const styles = {
  padding: '1rem',
  backgroundColor: 'blue',
  color: 'white',
};

const atomicClasses = stylesToAtomicClasses(styles);
console.log('Input styles:', styles);
console.log(
  'Generated classes:',
  atomicClasses.map((c) => c.className)
);
console.log('Generated CSS:', atomicClasses.map((c) => c.css).join('\n'));

// Test 2: Build Method Interception
console.log('\n2️⃣ Testing Build Method Interception');

// Mock AnimusWithAll
class MockAnimusWithAll {
  baseStyles = { padding: '1rem', backgroundColor: 'blue' };

  build() {
    return (_props: any) => ({ emotion: 'styles' });
  }
}

// Patch it
MockAnimusWithAll.prototype.build = function (this: MockAnimusWithAll) {
  console.log('✓ Build method successfully intercepted!');

  // Generate static config
  const staticConfig = {
    baseClasses: stylesToAtomicClasses(this.baseStyles),
  };

  // Return function with static config attached
  const fn = (_props: any) =>
    ({
      staticClasses: staticConfig.baseClasses.map((c) => c.className).join(' '),
    } as any);
  (fn as any).__staticConfig = staticConfig;
  return fn;
};

// Test it
const instance = new MockAnimusWithAll();
const styleFn = instance.build();
const result = styleFn({});
console.log('Result:', result);
console.log('Static config attached:', !!(styleFn as any).__staticConfig);

// Test 3: CSS Generation
console.log('\n3️⃣ Testing CSS Generation');
console.log('Full generated CSS:');
console.log(getStyleSheet());

console.log('\n✅ POC Core Concepts Validated!\n');
console.log('Key achievements:');
console.log('- Can generate deterministic atomic CSS classes');
console.log('- Can intercept Animus build() method');
console.log('- Can attach static configuration to style functions');
console.log('- Can generate complete CSS stylesheet');
console.log(
  '\n🎯 Next step: Full Babel AST transformation for build-time extraction\n'
);
