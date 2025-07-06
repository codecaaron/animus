import * as fs from 'fs';

import { describe, expect, it } from 'vitest';

import { createStaticExtractor } from '../index';

describe('Custom Props Extraction', () => {
  it('should extract custom props - snapshot test', () => {
    const testFile = '/tmp/test-snapshot-custom-props.tsx';
    const content = `
      import { animus } from '@animus-ui/core';
      
      // Component with custom props
      const Card = animus
        .styles({
          padding: '16px',
          backgroundColor: 'white',
          borderRadius: '8px',
        })
        .props({
          gap: { property: 'gap', scale: 'space' }, // This overrides the global gap prop
          rounded: { property: 'borderRadius', scale: 'radii' },
          shadow: { property: 'boxShadow', scale: 'shadows' },
          elevation: { property: 'boxShadow', scale: 'shadows', transform: 'elevationToShadow' },
        })
        .asElement('div');

      // Extended component that adds more custom props
      const FancyCard = Card
        .extend()
        .styles({
          border: '1px solid #e0e0e0',
        })
        .props({
          glow: { property: 'boxShadow', scale: 'glows' },
          spacing: { property: 'padding', scale: 'space' },
        })
        .asElement('div');

      // Usage examples
      const App = () => (
        <div>
          <Card gap={4} rounded="lg" shadow="md" p={8}>
            Basic Card with custom props
          </Card>
          
          <FancyCard glow="primary" spacing={6} elevation={2}>
            Fancy Card with inherited and new props
          </FancyCard>
          
          <Card m={4} bg="gray.100" color="text.primary">
            Card using both custom and global props
          </Card>
        </div>
      );
      
      export { Card, FancyCard, App };
    `;

    fs.writeFileSync(testFile, content);

    const extractor = createStaticExtractor();
    const result = extractor.extractFile(testFile);

    expect(result.errors).toEqual([]);

    // Create a clean snapshot of the extraction result
    const snapshot = {
      componentsFound: result.components.length,
      components: result.components.map((comp) => ({
        componentId: comp.componentId,
        componentClass: comp.componentClass.className,
        baseStylesCount: comp.componentClass.baseStyles.properties.size,
        baseStyles: Array.from(
          comp.componentClass.baseStyles.properties.entries()
        ).map(([key, value]) => ({
          property: key,
          value: value.value,
        })),
        // Global atomic classes
        atomicClassesCount: comp.atomicClasses.required.length,
        atomicClasses: comp.atomicClasses.required.map((atomic) => ({
          className: atomic.className,
          property: atomic.property,
          value: atomic.value,
          sourcesCount: atomic.sources.length,
        })),
        // Custom (namespaced) atomic classes
        customAtomicClassesCount: comp.atomicClasses.customRequired.length,
        customAtomicClasses: comp.atomicClasses.customRequired.map(
          (atomic) => ({
            className: atomic.className,
            property: atomic.property,
            value: atomic.value,
            sourcesCount: atomic.sources.length,
          })
        ),
      })),
    };

    expect(snapshot).toMatchSnapshot();

    fs.unlinkSync(testFile);
  });
  it('should extract and use component-level custom props', () => {
    const testFile = '/tmp/test-custom-props.tsx';
    const content = `
      import { animus } from '@animus-ui/core';
      
      // Note: gap is already in the global registry (via flex/grid groups)
      // but we're defining custom props for rounded and shadow
      const Card = animus
        .styles({
          padding: '16px',
          backgroundColor: 'white',
        })
        .props({
          rounded: { property: 'borderRadius', scale: 'radii' },
          shadow: { property: 'boxShadow', scale: 'shadows' },
        })
        .asElement('div');

      const App = () => (
        <Card gap={4} rounded="md" shadow="lg">
          <h1>Hello</h1>
        </Card>
      );
    `;

    fs.writeFileSync(testFile, content);

    const extractor = createStaticExtractor();
    const result = extractor.extractFile(testFile);

    expect(result.errors).toEqual([]);
    expect(result.components).toHaveLength(1);

    const card = result.components[0];
    expect(card?.componentClass.className).toMatch(/^animus-Card-/);

    // Check that custom props were extracted as atomic classes
    const globalAtomics = card?.atomicClasses.required || [];
    const customAtomics = card?.atomicClasses.customRequired || [];

    // gap is in global registry but also defined in custom props
    // Since we removed gap from custom props in this test, only rounded and shadow are custom
    // gap should use global atomic class
    expect(globalAtomics).toHaveLength(1);
    expect(customAtomics).toHaveLength(2);

    // gap should be in global atomics (not defined in custom props for this component)
    const gapAtomic = globalAtomics.find((a) => a.className.includes('gap'));
    expect(gapAtomic).toBeDefined();
    expect(gapAtomic?.className).toBe('animus-gap-4');
    expect(gapAtomic?.property).toBe('gap');
    expect(gapAtomic?.value).toBe('4');

    // rounded and shadow should be in custom atomics with namespacing
    const roundedAtomic = customAtomics.find((a) =>
      a.className.includes('rounded')
    );
    expect(roundedAtomic).toBeDefined();
    expect(roundedAtomic?.className).toMatch(
      /^animus-Card-[a-z0-9]+-rounded-md$/
    );
    expect(roundedAtomic?.property).toBe('border-radius');
    expect(roundedAtomic?.value).toBe('md');

    const shadowAtomic = customAtomics.find((a) =>
      a.className.includes('shadow')
    );
    expect(shadowAtomic).toBeDefined();
    expect(shadowAtomic?.className).toMatch(
      /^animus-Card-[a-z0-9]+-shadow-lg$/
    );
    expect(shadowAtomic?.property).toBe('box-shadow');
    expect(shadowAtomic?.value).toBe('lg');

    fs.unlinkSync(testFile);
  });

  it('should namespace custom props while keeping global props', () => {
    const testFile = '/tmp/test-merged-props.tsx';
    const content = `
      import { animus } from '@animus-ui/core';
      
      // Define a custom prop that doesn't exist in global registry
      const Box = animus
        .styles({
          display: 'flex',
        })
        .props({
          spacing: { property: 'padding', scale: 'customSpace' },
        })
        .asElement('div');

      const App = () => (
        <Box spacing={8} m={4}>
          Content
        </Box>
      );
    `;

    fs.writeFileSync(testFile, content);

    const extractor = createStaticExtractor();
    const result = extractor.extractFile(testFile);

    expect(result.errors).toEqual([]);

    const box = result.components[0];
    const globalAtomics = box?.atomicClasses.required || [];
    const customAtomics = box?.atomicClasses.customRequired || [];

    // Should have 1 global and 1 custom atomic class
    expect(globalAtomics).toHaveLength(1);
    expect(customAtomics).toHaveLength(1);

    // The 'spacing' prop should be in custom atomics with a namespaced class
    const spacingAtomic = customAtomics.find((a) =>
      a.className.includes('spacing-8')
    );
    expect(spacingAtomic).toBeDefined();
    expect(spacingAtomic?.className).toMatch(
      /^animus-Box-[a-z0-9]+-spacing-8$/
    );
    expect(spacingAtomic?.value).toBe('8');

    // The 'm' prop should be in global atomics
    const mAtomic = globalAtomics.find((a) => a.className === 'animus-m-4');
    expect(mAtomic).toBeDefined();
    expect(mAtomic?.value).toBe('4');

    fs.unlinkSync(testFile);
  });
});
