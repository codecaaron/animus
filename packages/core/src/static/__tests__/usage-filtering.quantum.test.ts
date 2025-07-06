import { describe, expect, it } from 'vitest';

import { extractStylesFromCode } from '../extractor';
import { CSSGenerator } from '../generator';
import { buildUsageMap, extractComponentUsage } from '../usageCollector';
import { testGroups as groupDefinitions, testTheme } from './test-utils';

/**
 * QUANTUM TEST: Usage-based Atomic CSS Filtering
 *
 * This test suite validates that atomic utilities are only generated
 * for prop values that are actually used in the codebase.
 */

describe('[QUANTUM] Usage-based atomic CSS filtering', () => {
  it('should only generate utilities for actually used prop values', () => {
    // Component definition with space group enabled
    const componentCode = `
      const Box = animus
        .styles({
          display: 'block',
          position: 'relative'
        })
        .groups({ space: true })
        .asElement('div');
    `;

    // Usage code showing which props are actually used
    const usageCode = `
      function App() {
        return (
          <>
            <Box p={4} />
            <Box mx={2} />
            <Box p={[1, 2]} />
            <Box m={0} />
          </>
        );
      }
    `;

    // Extract component definition
    const extracted = extractStylesFromCode(componentCode);
    expect(extracted).toHaveLength(1);

    // Extract usage
    const usages = extractComponentUsage(usageCode);
    const usageMap = buildUsageMap(usages);

    // Generate CSS without usage map (baseline - no utilities without usage data)
    const generator = new CSSGenerator({ prefix: 'animus' });
    const withoutUsage = generator.generateFromExtracted(
      extracted[0],
      groupDefinitions,
      testTheme
    );

    // Generate CSS with usage map (filtered - only used utilities)
    const withUsage = generator.generateFromExtracted(
      extracted[0],
      groupDefinitions,
      testTheme,
      usageMap
    );

    // Verify usage map contains expected values
    expect(usageMap.Box).toBeDefined();
    expect(usageMap.Box.p).toEqual(new Set(['4:_', '1:_', '2:xs']));
    expect(usageMap.Box.mx).toEqual(new Set(['2:_']));
    expect(usageMap.Box.m).toEqual(new Set(['0:_']));

    // Verify CSS output
    expect(withoutUsage.css).not.toContain('.animus-p-'); // No utilities without usage
    expect(withUsage.css).toContain('.animus-p-4'); // Used value
    expect(withUsage.css).toContain('.animus-p-1'); // Used value
    expect(withUsage.css).toContain('.animus-mx-2'); // Used value
    expect(withUsage.css).toContain('.animus-m-0'); // Used value
    expect(withUsage.css).not.toContain('.animus-p-3'); // Unused value
  });

  it('should handle responsive values in usage tracking', () => {
    const componentCode = `
      const Card = animus
        .styles({
          backgroundColor: 'white',
          borderRadius: '8px'
        })
        .groups({ space: true })
        .asElement('div');
    `;

    const usageCode = `
      function Layout() {
        return (
          <Card p={{ _: 2, sm: 4, lg: 6 }} m={[1, 2, , 4]} />
        );
      }
    `;

    const extracted = extractStylesFromCode(componentCode);
    const usages = extractComponentUsage(usageCode);
    const usageMap = buildUsageMap(usages);

    const generator = new CSSGenerator({ prefix: 'animus' });
    const result = generator.generateFromExtracted(
      extracted[0],
      groupDefinitions,
      testTheme,
      usageMap
    );

    // Verify usage map for responsive values
    expect(usageMap.Card).toBeDefined();
    expect(usageMap.Card.p).toEqual(new Set(['2:_', '4:sm', '6:lg']));
    expect(usageMap.Card.m).toEqual(new Set(['1:_', '2:xs', '4:sm']));

    // Verify generated CSS includes responsive utilities
    expect(result.css).toContain('.animus-p-2'); // Base
    expect(result.css).toContain('.animus-p-4-sm'); // SM breakpoint
    expect(result.css).toContain('.animus-p-6-lg'); // LG breakpoint
    expect(result.css).toContain('.animus-m-1'); // Base
    expect(result.css).toContain('.animus-m-2-xs'); // XS breakpoint
    expect(result.css).toContain('.animus-m-4-sm'); // SM breakpoint
  });

  it('should handle multiple components with different usage patterns', () => {
    const componentCode = `
      const Button = animus
        .styles({
          cursor: 'pointer',
          border: 'none'
        })
        .groups({ space: true })
        .asElement('button');

      const Text = animus
        .styles({
          lineHeight: 1.5
        })
        .groups({ space: true, typography: true })
        .asElement('p');
    `;

    const usageCode = `
      function Page() {
        return (
          <div>
            <Button p={3} m={0} />
            <Button px={4} py={2} />
            <Text p={2} fontSize="lg" lineHeight={1.8} />
            <Text m={1} fontSize="sm" />
          </div>
        );
      }
    `;

    const extracted = extractStylesFromCode(componentCode);
    const usages = extractComponentUsage(usageCode);
    const usageMap = buildUsageMap(usages);

    const generator = new CSSGenerator({ prefix: 'animus' });

    // Generate CSS for both components
    const buttonCSS = generator.generateFromExtracted(
      extracted[0],
      groupDefinitions,
      testTheme,
      usageMap
    );

    const textCSS = generator.generateFromExtracted(
      extracted[1],
      groupDefinitions,
      testTheme,
      usageMap
    );

    // Verify usage maps for both components
    expect(usageMap.Button).toBeDefined();
    expect(usageMap.Button.p).toEqual(new Set(['3:_']));
    expect(usageMap.Button.m).toEqual(new Set(['0:_']));
    expect(usageMap.Button.px).toEqual(new Set(['4:_']));
    expect(usageMap.Button.py).toEqual(new Set(['2:_']));

    expect(usageMap.Text).toBeDefined();
    expect(usageMap.Text.p).toEqual(new Set(['2:_']));
    expect(usageMap.Text.m).toEqual(new Set(['1:_']));
    expect(usageMap.Text.fontSize).toEqual(new Set(['lg:_', 'sm:_']));
    expect(usageMap.Text.lineHeight).toEqual(new Set(['1.8:_']));

    // Verify CSS outputs contain only used utilities
    expect(buttonCSS.css).toContain('.animus-p-3');
    expect(buttonCSS.css).toContain('.animus-m-0');
    expect(buttonCSS.css).toContain('.animus-px-4');
    expect(buttonCSS.css).toContain('.animus-py-2');

    expect(textCSS.css).toContain('.animus-p-2');
    expect(textCSS.css).toContain('.animus-m-1');
    expect(textCSS.css).toContain('.animus-fs-lg');
    expect(textCSS.css).toContain('.animus-fs-sm');
    expect(textCSS.css).toContain('.animus-lin-18');
  });

  it('should handle edge cases in usage collection', () => {
    const componentCode = `
      const Flex = animus
        .styles({
          display: 'flex'
        })
        .groups({ space: true })
        .asElement('div');
    `;

    const usageCode = `
      function EdgeCases() {
        const dynamicValue = Math.random() > 0.5 ? 2 : 4;

        return (
          <>
            {/* Boolean prop */}
            <Flex p />
            {/* Zero value */}
            <Flex m={0} />
            {/* Negative value */}
            <Flex m={-2} />
            {/* String value */}
            <Flex p="auto" />
            {/* Dynamic value - won't be captured */}
            <Flex p={dynamicValue} />
            {/* Computed property - won't be captured */}
            <Flex {...{ p: 3 }} />
          </>
        );
      }
    `;

    extractStylesFromCode(componentCode);
    const usages = extractComponentUsage(usageCode);
    const usageMap = buildUsageMap(usages);

    // Verify edge case handling
    expect(usageMap.Flex).toBeDefined();
    expect(usageMap.Flex.p).toContain('true:_'); // Boolean true
    expect(usageMap.Flex.p).toContain('auto:_'); // String value
    expect(usageMap.Flex.m).toContain('0:_'); // Zero value
    expect(usageMap.Flex.m).toContain('-2:_'); // Negative value

    // Dynamic and computed values are not captured
    expect(usageMap.Flex.p).not.toContain('2:_');
    expect(usageMap.Flex.p).not.toContain('3:_');
    expect(usageMap.Flex.p).not.toContain('4:_');
  });

  it('should generate scoped utilities per component', () => {
    const componentCode = `
      const Container = animus
        .styles({ display: 'block' })
        .groups({ space: true })
        .asElement('div');

      const Wrapper = animus
        .styles({ display: 'flex' })
        .groups({ space: true })
        .asElement('div');
    `;

    const usageCode = `
      function App() {
        return (
          <>
            <Container p={4} m={2} />
            <Wrapper p={2} m={4} />
          </>
        );
      }
    `;

    const extracted = extractStylesFromCode(componentCode);
    const usages = extractComponentUsage(usageCode);
    const usageMap = buildUsageMap(usages);

    const generator = new CSSGenerator({ prefix: 'animus' });

    // Generate CSS for each component
    const containerCSS = generator.generateFromExtracted(
      extracted[0],
      groupDefinitions,
      testTheme,
      usageMap
    );

    const wrapperCSS = generator.generateFromExtracted(
      extracted[1],
      groupDefinitions,
      testTheme,
      usageMap
    );

    // Each component should only generate utilities for its own usage
    expect(containerCSS.css).toContain('.animus-p-4');
    expect(containerCSS.css).toContain('.animus-m-2');
    expect(containerCSS.css).not.toContain('.animus-p-2'); // Only used by Wrapper
    expect(containerCSS.css).not.toContain('.animus-m-4'); // Only used by Wrapper

    expect(wrapperCSS.css).toContain('.animus-p-2');
    expect(wrapperCSS.css).toContain('.animus-m-4');
    expect(wrapperCSS.css).not.toContain('.animus-p-4'); // Only used by Container
    expect(wrapperCSS.css).not.toContain('.animus-m-2'); // Only used by Container
  });

  it('should handle theme scale values in usage', () => {
    const componentCode = `
      const ThemedBox = animus
        .styles({
          display: 'block'
        })
        .groups({ space: true, color: true })
        .asElement('div');
    `;

    const usageCode = `
      function ThemedApp() {
        return (
          <>
            <ThemedBox p={4} bg="primary" />
            <ThemedBox m="auto" color="secondary" />
            <ThemedBox px={[2, 4, 6]} bg={{ _: 'white', dark: 'black' }} />
          </>
        );
      }
    `;

    extractStylesFromCode(componentCode);
    const usages = extractComponentUsage(usageCode);
    const usageMap = buildUsageMap(usages);

    // Verify theme scale values are captured
    expect(usageMap.ThemedBox.bg).toContain('primary:_');
    expect(usageMap.ThemedBox.bg).toContain('white:_');
    expect(usageMap.ThemedBox.bg).toContain('black:dark');
    expect(usageMap.ThemedBox.color).toContain('secondary:_');
    expect(usageMap.ThemedBox.m).toContain('auto:_');
    expect(usageMap.ThemedBox.px).toContain('2:_');
    expect(usageMap.ThemedBox.px).toContain('4:xs');
    expect(usageMap.ThemedBox.px).toContain('6:sm');
  });

  it('should not generate utilities when no usage is provided', () => {
    const componentCode = `
      const UnusedBox = animus
        .styles({
          display: 'block'
        })
        .groups({ space: true, color: true, typography: true })
        .asElement('div');
    `;

    const extracted = extractStylesFromCode(componentCode);
    const generator = new CSSGenerator({ prefix: 'animus' });

    // Generate without usage map
    const result = generator.generateFromExtracted(
      extracted[0],
      groupDefinitions,
      testTheme
    );

    // Should generate component styles but no utilities
    expect(result.css).toContain('display: block'); // Base styles
    expect(result.css).not.toContain('.animus-p-'); // No padding utilities
    expect(result.css).not.toContain('.animus-m-'); // No margin utilities
    expect(result.css).not.toContain('.animus-text-'); // No text utilities
    expect(result.css).not.toContain('.animus-bg-'); // No background utilities
  });
});
