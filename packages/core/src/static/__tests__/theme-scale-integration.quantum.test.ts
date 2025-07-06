import { describe, expect, it } from 'vitest';

import { extractStylesFromCode } from '../extractor';
import { CSSGenerator } from '../generator';
import { buildUsageMap, extractComponentUsage } from '../usageCollector';
import { quantumGroups, quantumTheme } from './test-utils';

describe('Theme Scale Integration', () => {
  const generator = new CSSGenerator({
    themeResolution: { mode: 'hybrid' },
  });

  it('should resolve theme tokens using prop scales from groups', () => {
    const code = `
      const Card = animus
        .styles({ padding: '1rem', backgroundColor: 'background.elevated' })
        .groups({ color: true, space: true })
        .asElement('div');
    `;

    const usageCode = `
      export const App = () => (
        <Card
          bg="primary"
          color="text.primary"
          p="md"
          m={['sm', 'md', 'lg']}
        >
          Content
        </Card>
      );
    `;

    const components = extractStylesFromCode(code);
    expect(components).toHaveLength(1);

    const usages = extractComponentUsage(usageCode);
    const usageMap = buildUsageMap(usages);

    const result = generator.generateFromExtracted(
      components[0],
      quantumGroups,
      quantumTheme,
      usageMap
    );

    expect(result.css).toMatchSnapshot();
    expect(result.css).toContain('.animus-Card');
    expect(result.css).toContain('padding: 1rem');

    // Atomic utilities should be generated for used props
    expect(result.css).toContain('.animus-bg-primary');
    expect(result.css).toContain('.animus-c-textprimary');
    expect(result.css).toContain('.animus-p-md');
  });

  it('should handle custom props with theme scales', () => {
    const code = `
      const ThemedBox = animus
        .styles({ display: 'block' })
        .props({
          bgGradient: {
            property: 'backgroundImage',
            scale: 'colors',
            transform: v => \`linear-gradient(to right, \${v}, transparent)\`
          },
          spacing: {
            property: 'letterSpacing',
            scale: 'space'
          }
        })
        .asElement('div');
    `;

    const components = extractStylesFromCode(code);
    expect(components).toHaveLength(1);

    // For this test, we'll use an empty usage map since we're testing the props definition
    const usageMap = {};

    const result = generator.generateFromExtracted(
      components[0],
      quantumGroups,
      quantumTheme,
      usageMap
    );

    expect(result.css).toMatchSnapshot();
    // The CSS should contain the component class but no utilities without usage
    expect(result.css).toContain('.animus-ThemedBox');
  });

  it('should avoid double-prefixing when values contain scale names', () => {
    const code = `
      const ColorBox = animus
        .styles({ boxSizing: 'border-box' })
        .groups({ color: true })
        .asElement('div');
    `;

    const usageCode = `
      export const App = () => (
        <ColorBox
          bg="colors.primary"
          color="secondary"
        />
      );
    `;

    const components = extractStylesFromCode(code);
    expect(components).toHaveLength(1);

    const usages = extractComponentUsage(usageCode);
    const usageMap = buildUsageMap(usages);

    const result = generator.generateFromExtracted(
      components[0],
      quantumGroups,
      quantumTheme,
      usageMap
    );

    expect(result.css).toMatchSnapshot();
    expect(result.css).toContain('.animus-ColorBox');

    // Should handle both scale-prefixed and non-prefixed values
    expect(result.css).toContain('.animus-bg-colorsprimary');
    expect(result.css).toContain('.animus-c-secondary');
  });
});
