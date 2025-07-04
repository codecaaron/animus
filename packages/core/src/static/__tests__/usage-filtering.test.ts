import { extractStylesFromCode } from '../extractor';
import { CSSGenerator } from '../generator';
import { buildUsageMap, extractComponentUsage } from '../usageCollector';
import { groupDefinitions, testTheme } from './testConfig';

describe('Usage-based atomic CSS filtering', () => {
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

    // Snapshot CSS outputs
    expect({
      withoutUsageFiltering: withoutUsage.css,
      withUsageFiltering: withUsage.css,
    }).toMatchSnapshot();
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

    // Snapshot CSS output
    expect(result.css).toMatchSnapshot();
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

    // Snapshot CSS outputs
    expect({
      button: buttonCSS.css,
      text: textCSS.css,
    }).toMatchSnapshot();
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
            
            {/* String value */}
            <Flex m="auto" />
            
            {/* Number zero */}
            <Flex p={0} />
            
            {/* Null/undefined - should be ignored */}
            <Flex m={null} p={undefined} />
            
            {/* Dynamic value - won't be extracted */}
            <Flex p={dynamicValue} />
            
            {/* Spread props - not handled yet */}
            <Flex {...props} />
          </>
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

    // Verify edge case handling
    expect(usageMap.Flex).toBeDefined();
    expect(usageMap.Flex.p).toEqual(new Set(['true:_', '0:_']));
    expect(usageMap.Flex.m).toEqual(new Set(['auto:_', 'null:_']));

    // Verify extracted usages include all cases
    expect(usages).toHaveLength(6); // 6 Flex components

    // Snapshot CSS output only
    expect(result.css).toMatchSnapshot();
  });
});
