/* eslint-disable no-console */
/**
 * Simple validation that our POC approach works
 * This demonstrates the core concept without full integration
 */

import { stylesToAtomicClasses } from './atomic-css';
import { getStyleSheet } from './static-mode';

const styles = {
  padding: '1rem',
  backgroundColor: 'blue',
  color: 'white',
};

const _atomicClasses = stylesToAtomicClasses(styles);

// Mock AnimusWithAll
class MockAnimusWithAll {
  baseStyles = { padding: '1rem', backgroundColor: 'blue' };

  build() {
    return (_props: any) => ({ emotion: 'styles' });
  }
}

// Patch it
MockAnimusWithAll.prototype.build = function (this: MockAnimusWithAll) {
  // Generate static config
  const staticConfig = {
    baseClasses: stylesToAtomicClasses(this.baseStyles),
  };

  // Return function with static config attached
  const fn = (_props: any) =>
    ({
      staticClasses: staticConfig.baseClasses.map((c) => c.className).join(' '),
    }) as any;
  (fn as any).__staticConfig = staticConfig;
  return fn;
};

// Test it
const instance = new MockAnimusWithAll();
const styleFn = instance.build();
const _result = styleFn({});
