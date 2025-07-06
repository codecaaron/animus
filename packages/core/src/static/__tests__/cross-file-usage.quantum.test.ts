/**
 * [QUANTUM] Cross-File Usage Collection Tests
 *
 * Tests the tracking of component usage across multiple files using
 * virtual TypeScript programs instead of filesystem operations.
 */

import { describe, expect, it } from 'vitest';

import { createComponentIdentity } from '../component-identity';
import { CrossFileUsageCollector } from '../cross-file-usage';
import {
  createComponentFile,
  createUsageFile,
  createVirtualProgram,
} from './test-utils/virtual-program';

describe('[QUANTUM] Cross-File Usage Collector', () => {
  describe('Single File Usage Collection', () => {
    it('should collect component usage with identity', () => {
      const files = {
        '/src/Button.tsx': createComponentFile('Button', {
          styles: { padding: '8px 16px' },
          variants: {
            size: {
              small: { padding: '4px 8px' },
              large: { padding: '12px 24px' },
            },
          },
        }),
        '/src/App.tsx': createUsageFile([
          {
            component: 'Button',
            importPath: './Button',
            props: { size: 'small' },
            children: 'Click me',
          },
          {
            component: 'Button',
            importPath: './Button',
            props: { size: 'large', className: 'custom' },
            children: 'Big button',
          },
        ]),
      };

      const program = createVirtualProgram(files);
      const collector = new CrossFileUsageCollector(program);

      const usages = collector.collectFromFile('/src/App.tsx');

      expect(usages).toHaveLength(2);

      // First usage
      expect(usages[0]).toMatchObject({
        componentName: 'Button',
        props: { size: 'small' },
        identity: {
          name: 'Button',
          filePath: '/src/Button.tsx',
          exportName: 'Button',
        },
        usageLocation: '/src/App.tsx',
      });

      // Second usage
      expect(usages[1]).toMatchObject({
        componentName: 'Button',
        props: { size: 'large', className: 'custom' },
      });
    });

    it('should handle responsive prop values', () => {
      const files = {
        '/src/Box.tsx': createComponentFile('Box', {
          groups: ['space'],
        }),
        '/src/App.tsx': `
import React from 'react';
import { Box } from './Box';

export function App() {
  return (
    <Box
      p={[1, 2, 3]}
      m={{ _: 0, sm: 1, md: 2 }}
    >
      Content
    </Box>
  );
}
`,
      };

      const program = createVirtualProgram(files);
      const collector = new CrossFileUsageCollector(program);

      const usages = collector.collectFromFile('/src/App.tsx');

      expect(usages).toHaveLength(1);
      expect(usages[0].props).toEqual({
        p: [1, 2, 3],
        m: { _: 0, sm: 1, md: 2 },
      });
    });
  });

  describe('Program-Wide Usage Collection', () => {
    it('should aggregate usage across multiple files', () => {
      const files = {
        '/src/Button.tsx': createComponentFile('Button', {
          styles: { padding: '8px' },
        }),
        '/src/Page1.tsx': createUsageFile([
          {
            component: 'Button',
            importPath: './Button',
            props: { variant: 'primary' },
          },
        ]),
        '/src/Page2.tsx': createUsageFile([
          {
            component: 'Button',
            importPath: './Button',
            props: { variant: 'secondary' },
          },
          {
            component: 'Button',
            importPath: './Button',
            props: { variant: 'primary', disabled: true },
          },
        ]),
      };

      const program = createVirtualProgram(files);
      const collector = new CrossFileUsageCollector(program);

      const globalMap = collector.collectFromProgram();

      // Should have one component
      expect(globalMap.size).toBe(1);

      const buttonEntry = Array.from(globalMap.values())[0];
      expect(buttonEntry.identity.name).toBe('Button');
      expect(buttonEntry.usages).toHaveLength(3);

      // Check aggregated prop values
      const variantValues = buttonEntry.propValueSets.get('variant');
      expect(variantValues).toBeDefined();
      expect(variantValues?.has('primary:_')).toBe(true);
      expect(variantValues?.has('secondary:_')).toBe(true);

      const disabledValues = buttonEntry.propValueSets.get('disabled');
      expect(disabledValues?.has('true:_')).toBe(true);
    });

    it('should handle responsive prop aggregation', () => {
      const files = {
        '/src/Box.tsx': createComponentFile('Box', {
          groups: ['space'],
        }),
        '/src/Page1.tsx': createUsageFile([
          {
            component: 'Box',
            importPath: './Box',
            props: { p: [2, 4, 6], m: { _: 1, sm: 2 } },
          },
        ]),
        '/src/Page2.tsx': createUsageFile([
          {
            component: 'Box',
            importPath: './Box',
            props: { p: { _: 2, md: 8 }, m: [1, 2, 3] },
          },
        ]),
      };

      const program = createVirtualProgram(files);
      const collector = new CrossFileUsageCollector(program);

      const globalMap = collector.collectFromProgram();
      const boxEntry = Array.from(globalMap.values())[0];

      // Check responsive values are properly aggregated
      const paddingValues = boxEntry.propValueSets.get('p');
      expect(paddingValues).toContain('2:_');
      expect(paddingValues).toContain('4:xs');
      expect(paddingValues).toContain('6:sm');
      expect(paddingValues).toContain('8:md');

      const marginValues = boxEntry.propValueSets.get('m');
      expect(marginValues).toContain('1:_');
      expect(marginValues).toContain('2:xs');
      expect(marginValues).toContain('2:sm');
      expect(marginValues).toContain('3:sm');
    });
  });

  describe('Compound Components', () => {
    it('should handle compound component usage', () => {
      const files = {
        '/src/Layout.tsx': `
import { animus } from '@animus-ui/core';

const LayoutContainer = animus
  .styles({ display: 'grid' })
  .asElement('div');

const LayoutHeader = animus
  .styles({ gridArea: 'header' })
  .asElement('header');

const LayoutSidebar = animus
  .styles({ gridArea: 'sidebar' })
  .asElement('aside');

LayoutContainer.Header = LayoutHeader;
LayoutContainer.Sidebar = LayoutSidebar;

export const Layout = LayoutContainer;
`,
        '/src/App.tsx': createUsageFile([
          {
            component: 'Layout',
            importPath: './Layout',
            props: { gap: 4 },
          },
          {
            component: 'Layout.Header',
            importPath: './Layout',
            props: { p: 2 },
          },
          {
            component: 'Layout.Sidebar',
            importPath: './Layout',
            props: { bg: 'gray' },
          },
        ]),
      };

      const program = createVirtualProgram(files);
      const collector = new CrossFileUsageCollector(program);

      const usages = collector.collectFromFile('/src/App.tsx');

      expect(usages).toHaveLength(3);
      expect(usages[0].componentName).toBe('Layout');
      expect(usages[1].componentName).toBe('Layout.Header');
      expect(usages[2].componentName).toBe('Layout.Sidebar');
    });
  });

  describe('Import Patterns', () => {
    it('should track usage with different import patterns', () => {
      const files = {
        '/src/components/Button.tsx': createComponentFile('Button', {
          styles: { padding: '8px' },
        }),
        '/src/components/index.ts': `
export { Button } from './Button';
export { Button as PrimaryButton } from './Button';
`,
        '/src/App.tsx': `
import React from 'react';
import { Button, PrimaryButton } from './components';
import { Button as MyButton } from './components/Button';

export function App() {
  return (
    <div>
      <Button size="small" />
      <PrimaryButton size="medium" />
      <MyButton size="large" />
    </div>
  );
}
`,
      };

      const program = createVirtualProgram(files);
      const collector = new CrossFileUsageCollector(program);

      const usages = collector.collectFromFile('/src/App.tsx');

      expect(usages).toHaveLength(3);
      // All should resolve to the same Button component
      expect(usages.every((u) => u.identity.name === 'Button')).toBe(true);
      expect(
        usages.every(
          (u) => u.identity.filePath === '/src/components/Button.tsx'
        )
      ).toBe(true);
    });

    it('should handle re-exports correctly', () => {
      const files = {
        '/src/base/Button.tsx': createComponentFile('Button', {
          styles: { padding: '8px' },
        }),
        '/src/components/Button.tsx': `
export { Button } from '../base/Button';
export { Button as BaseButton } from '../base/Button';
`,
        '/src/index.ts': `
export * from './components/Button';
`,
        '/src/App.tsx': `
import React from 'react';
import { Button, BaseButton } from './index';

export function App() {
  return (
    <>
      <Button variant="primary" />
      <BaseButton variant="secondary" />
    </>
  );
}
`,
      };

      const program = createVirtualProgram(files);
      const collector = new CrossFileUsageCollector(program);

      const usages = collector.collectFromFile('/src/App.tsx');

      expect(usages).toHaveLength(2);
      // Both should resolve to the original Button
      expect(usages[0].identity.filePath).toBe('/src/base/Button.tsx');
      expect(usages[1].identity.filePath).toBe('/src/base/Button.tsx');
    });
  });

  describe('Component Usage Mapping', () => {
    it('should build component usage map with value deduplication', () => {
      const files = {
        '/src/Button.tsx': createComponentFile('Button', {
          styles: { padding: '8px' },
          groups: ['space'],
        }),
        '/src/App.tsx': createUsageFile([
          {
            component: 'Button',
            importPath: './Button',
            props: { p: 4, m: 2 },
          },
          {
            component: 'Button',
            importPath: './Button',
            props: { p: 4, m: 3 },
          },
          {
            component: 'Button',
            importPath: './Button',
            props: { p: 6 },
          },
        ]),
      };

      const program = createVirtualProgram(files);
      const collector = new CrossFileUsageCollector(program);

      const buttonIdentity = createComponentIdentity(
        'Button',
        '/src/Button.tsx',
        'Button'
      );
      const usageMap = collector.buildComponentUsageMap(buttonIdentity);

      expect(usageMap.Button).toBeDefined();
      expect(usageMap.Button.p).toEqual(new Set(['4:_', '6:_']));
      expect(usageMap.Button.m).toEqual(new Set(['2:_', '3:_']));
    });
  });

  describe('Usage Statistics', () => {
    it('should provide usage statistics', () => {
      const files = {
        '/src/Button.tsx': createComponentFile('Button', {}),
        '/src/Card.tsx': createComponentFile('Card', {}),
        '/src/Unused.tsx': createComponentFile('Unused', {}),
        '/src/App.tsx': createUsageFile([
          {
            component: 'Button',
            importPath: './Button',
            props: { variant: 'primary' },
            children: 'One',
          },
          {
            component: 'Button',
            importPath: './Button',
            props: { variant: 'secondary' },
            children: 'Two',
          },
          {
            component: 'Button',
            importPath: './Button',
            props: {},
            children: 'Three',
          },
          {
            component: 'Card',
            importPath: './Card',
            props: { title: 'Hello' },
          },
        ]),
      };

      const program = createVirtualProgram(files);
      const collector = new CrossFileUsageCollector(program);

      const stats = collector.getUsageStats();

      expect(stats.totalComponents).toBe(2); // Only Button and Card are used
      expect(stats.totalUsages).toBe(4); // 3 Buttons + 1 Card

      const buttonStats = stats.componentsWithUsage.find(
        (c) => c.name === 'Button'
      );
      expect(buttonStats?.usageCount).toBe(3);
      expect(buttonStats?.uniqueProps).toBe(1); // Only 'variant' prop

      const cardStats = stats.componentsWithUsage.find(
        (c) => c.name === 'Card'
      );
      expect(cardStats?.usageCount).toBe(1);
      expect(cardStats?.uniqueProps).toBe(1); // Only 'title' prop
    });
  });

  describe('Edge Cases', () => {
    it('should handle components with no usage', () => {
      const files = {
        '/src/Button.tsx': createComponentFile('Button', {}),
        '/src/App.tsx': `
import React from 'react';
// Import but don't use
import { Button } from './Button';

export function App() {
  return <div>No buttons here</div>;
}
`,
      };

      const program = createVirtualProgram(files);
      const collector = new CrossFileUsageCollector(program);

      const usages = collector.collectFromFile('/src/App.tsx');
      expect(usages).toHaveLength(0);
    });

    it('should handle dynamic imports gracefully', () => {
      const files = {
        '/src/Button.tsx': createComponentFile('Button', {}),
        '/src/App.tsx': `
import React from 'react';

export function App() {
  const Button = React.lazy(() => import('./Button'));

  return (
    <React.Suspense fallback={<div>Loading...</div>}>
      <Button variant="primary" />
    </React.Suspense>
  );
}
`,
      };

      const program = createVirtualProgram(files);
      const collector = new CrossFileUsageCollector(program);

      // Dynamic imports are not currently tracked
      const usages = collector.collectFromFile('/src/App.tsx');
      expect(usages).toHaveLength(0);
    });

    it('should handle spread props', () => {
      const files = {
        '/src/Button.tsx': createComponentFile('Button', {
          groups: ['space', 'color'],
        }),
        '/src/App.tsx': `
import React from 'react';
import { Button } from './Button';

const baseProps = { p: 2, m: 1 };
const colorProps = { bg: 'blue', color: 'white' };

export function App() {
  return (
    <>
      <Button {...baseProps} />
      <Button {...baseProps} {...colorProps} />
      <Button {...{ ...baseProps, p: 4 }} />
    </>
  );
}
`,
      };

      const program = createVirtualProgram(files);
      const collector = new CrossFileUsageCollector(program);

      const usages = collector.collectFromFile('/src/App.tsx');

      // Spread props are challenging to track statically
      // The collector should at least identify the component usage
      expect(usages).toHaveLength(3);
      expect(usages.every((u) => u.componentName === 'Button')).toBe(true);
    });
  });
});
