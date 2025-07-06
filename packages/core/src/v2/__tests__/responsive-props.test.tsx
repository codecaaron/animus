import * as fs from 'fs';

import { describe, expect, it } from 'vitest';

import { createStaticExtractor } from '../index';

describe('Responsive Props', () => {
  it('should extract responsive props with array syntax - snapshot', () => {
    const testFile = '/tmp/test-responsive-array.tsx';
    const content = `
      import { animus } from '@animus-ui/core';
      
      const Card = animus
        .styles({
          backgroundColor: 'white',
          // Responsive styles in style block
          padding: ['8px', '12px', '16px', '20px', '24px', '32px'],
          display: ['block', 'flex'],
        })
        .asElement('div');

      const App = () => (
        <Card 
          // Responsive atomic props
          m={[2, 3, 4, 5]}
          p={[1, null, 2, null, 4]}
          gap={[0, 2, 3]}
        >
          Responsive array syntax
        </Card>
      );
    `;

    fs.writeFileSync(testFile, content);

    const extractor = createStaticExtractor();
    const result = extractor.extractFile(testFile);

    expect(result.errors).toEqual([]);

    const snapshot = {
      componentsFound: result.components.length,
      components: result.components.map((comp) => ({
        componentId: comp.componentId,
        componentClass: comp.componentClass.className,
        baseStyles: Array.from(
          comp.componentClass.baseStyles.properties.entries()
        ).map(([key, value]) => ({
          property: key,
          value: value.value,
          isResponsive:
            Array.isArray(value.value) ||
            (typeof value.value === 'object' && value.value !== null),
        })),
        // Required atomic classes (non-responsive)
        atomicClasses: comp.atomicClasses.required.map((atomic) => ({
          className: atomic.className,
          property: atomic.property,
          value: atomic.value,
        })),
        // Conditional atomic classes (responsive)
        conditionalAtomicClasses: comp.atomicClasses.conditional.map(
          (atomic) => ({
            className: atomic.className,
            property: atomic.property,
            value: atomic.value,
            condition: atomic.condition,
          })
        ),
      })),
    };

    expect(snapshot).toMatchSnapshot();

    fs.unlinkSync(testFile);
  });

  it('should extract responsive props with object syntax', () => {
    const testFile = '/tmp/test-responsive-object.tsx';
    const content = `
      import { animus } from '@animus-ui/core';
      
      const Box = animus
        .styles({
          display: 'flex',
        })
        .asElement('div');

      const App = () => (
        <Box 
          p={{ _: 2, sm: 3, md: 4, lg: 6 }}
          display={{ _: 'none', md: 'block', lg: 'flex' }}
          width={{ _: '100%', md: '50%', xl: '33.333%' }}
        >
          Responsive object syntax
        </Box>
      );
    `;

    fs.writeFileSync(testFile, content);

    const extractor = createStaticExtractor();
    const result = extractor.extractFile(testFile);

    expect(result.errors).toEqual([]);
    expect(result.components).toHaveLength(1);

    const box = result.components[0];
    const conditionals = box?.atomicClasses.conditional || [];

    // Should have conditional atomics for each breakpoint
    expect(conditionals.length).toBeGreaterThan(0);

    // Check padding responsive classes
    const pClasses = conditionals.filter((a) => a.property === 'padding');
    expect(pClasses).toHaveLength(4); // _, sm, md, lg

    const pBase = pClasses.find((a) => a.className === 'animus-p-2');
    expect(pBase?.condition.type).toBe('media');
    expect(pBase?.condition.query).toBe('all');

    const pMd = pClasses.find((a) => a.className === 'animus-p-4-md');
    expect(pMd?.condition.type).toBe('media');
    expect(pMd?.condition.query).toBe('(min-width: 768px)');

    fs.unlinkSync(testFile);
  });

  it('should handle responsive custom props', () => {
    const testFile = '/tmp/test-responsive-custom.tsx';
    const content = `
      import { animus } from '@animus-ui/core';
      
      const Card = animus
        .styles({
          padding: '16px',
        })
        .props({
          elevation: { property: 'boxShadow', scale: 'shadows' },
        })
        .asElement('div');

      const App = () => (
        <Card 
          elevation={{ _: 0, md: 2, lg: 4 }}
          m={[1, 2, 3]}
        >
          Responsive custom props
        </Card>
      );
    `;

    fs.writeFileSync(testFile, content);

    const extractor = createStaticExtractor();
    const result = extractor.extractFile(testFile);

    expect(result.errors).toEqual([]);

    const card = result.components[0];
    const customConditionals = card?.atomicClasses.customConditional || [];

    // Custom responsive props should be namespaced
    const elevationClasses = customConditionals.filter(
      (a) => a.property === 'box-shadow'
    );
    expect(elevationClasses.length).toBeGreaterThan(0);

    const elevationMd = elevationClasses.find((a) =>
      a.className.includes('-md')
    );
    expect(elevationMd?.className).toMatch(
      /^animus-Card-[a-z0-9]+-elevation-2-md$/
    );

    fs.unlinkSync(testFile);
  });
});
