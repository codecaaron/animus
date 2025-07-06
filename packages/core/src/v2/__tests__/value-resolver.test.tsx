import * as fs from 'fs';

import { describe, expect, it } from 'vitest';

import { createStaticExtractor } from '../index';

describe('Style Value Resolution', () => {
  it('should resolve theme values in atomic classes - snapshot', () => {
    const testFile = '/tmp/test-theme-values-snapshot.tsx';
    const content = `
      import { animus } from '@animus-ui/core';
      
      const Card = animus
        .styles({
          padding: '16px',
          backgroundColor: 'white',
          borderRadius: '8px',
        })
        .asElement('div');

      const App = () => (
        <div>
          <Card 
            p={4}
            m="space.4" 
            bg="colors.primary.500" 
            color="text.primary"
            borderColor="gray.200"
            fontSize="lg"
            fontWeight={600}
            width="100%"
            minHeight="24rem"
          >
            Theme values test
          </Card>
          
          <Card
            gap={3}
            display="flex"
            flexDirection="column"
            shadow="elevation.2"
          >
            More theme values
          </Card>
        </div>
      );
    `;

    fs.writeFileSync(testFile, content);

    const extractor = createStaticExtractor();
    const result = extractor.extractFile(testFile);

    expect(result.errors).toEqual([]);

    // Create a detailed snapshot
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
        })),
        // Global atomic classes
        atomicClasses: comp.atomicClasses.required.map((atomic) => ({
          className: atomic.className,
          property: atomic.property,
          value: atomic.value,
          originalValue: atomic.value, // In future, this might differ after resolution
        })),
        // Custom atomic classes
        customAtomicClasses: comp.atomicClasses.customRequired.map(
          (atomic) => ({
            className: atomic.className,
            property: atomic.property,
            value: atomic.value,
          })
        ),
      })),
    };

    expect(snapshot).toMatchSnapshot();

    fs.unlinkSync(testFile);
  });

  it('should resolve theme values in atomic classes', () => {
    const testFile = '/tmp/test-theme-values.tsx';
    const content = `
      import { animus } from '@animus-ui/core';
      
      const Card = animus
        .styles({
          padding: '16px',
          backgroundColor: 'white',
        })
        .asElement('div');

      const App = () => (
        <Card 
          p={4}
          m="space.4" 
          bg="colors.primary" 
          color="text.primary"
        >
          Theme values test
        </Card>
      );
    `;

    fs.writeFileSync(testFile, content);

    const extractor = createStaticExtractor();
    const result = extractor.extractFile(testFile);

    expect(result.errors).toEqual([]);
    expect(result.components).toHaveLength(1);

    const card = result.components[0];
    const globalAtomics = card?.atomicClasses.required || [];

    // For now, values should pass through as-is since we don't have a theme
    const pAtomic = globalAtomics.find((a) => a.className === 'animus-p-4');
    expect(pAtomic).toBeDefined();
    expect(pAtomic?.value).toBe('4');

    // Dots are removed from class names
    const mAtomic = globalAtomics.find(
      (a) => a.className === 'animus-m-space4'
    );
    expect(mAtomic).toBeDefined();
    expect(mAtomic?.value).toBe('space.4');

    const bgAtomic = globalAtomics.find(
      (a) => a.className === 'animus-bg-colorsprimary'
    );
    expect(bgAtomic).toBeDefined();
    expect(bgAtomic?.value).toBe('colors.primary');

    fs.unlinkSync(testFile);
  });

  it('should handle scale values', () => {
    const testFile = '/tmp/test-scale-values.tsx';
    const content = `
      import { animus } from '@animus-ui/core';
      
      const Box = animus
        .styles({
          display: 'flex',
        })
        .asElement('div');

      const App = () => (
        <Box 
          p={2}        // Should use space scale
          fontSize={3} // Should use fontSizes scale
          color="red"  // Should use colors scale
        >
          Scale values test
        </Box>
      );
    `;

    fs.writeFileSync(testFile, content);

    const extractor = createStaticExtractor();
    const result = extractor.extractFile(testFile);

    expect(result.errors).toEqual([]);

    const box = result.components[0];
    const atomics = box?.atomicClasses.required || [];

    // Values should be preserved as-is for now
    expect(atomics.find((a) => a.className === 'animus-p-2')).toBeDefined();
    expect(
      atomics.find((a) => a.className === 'animus-fontSize-3')
    ).toBeDefined();
    expect(
      atomics.find((a) => a.className === 'animus-color-red')
    ).toBeDefined();

    fs.unlinkSync(testFile);
  });
});
