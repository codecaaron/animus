import { describe, expect, it } from '@jest/globals';

import { extractStylesFromCode } from '../extractor';
import { CSSGenerator } from '../generator';
import { buildUsageMap, extractComponentUsage } from '../usageCollector';

describe('Theme Scale Integration', () => {
  const generator = new CSSGenerator({
    themeResolution: { mode: 'hybrid' },
  });

  const theme = {
    colors: {
      primary: '#007bff',
      secondary: '#6c757d',
      text: {
        primary: '#212529',
        secondary: '#6c757d',
        link: '#007bff',
      },
      background: {
        page: '#ffffff',
        elevated: '#f8f9fa',
      },
    },
    space: {
      xs: '0.25rem',
      sm: '0.5rem',
      md: '1rem',
      lg: '2rem',
    },
  };

  const groupDefinitions = {
    color: {
      color: { property: 'color', scale: 'colors' },
      bg: { property: 'backgroundColor', scale: 'colors' },
      fill: { property: 'fill', scale: 'colors' },
      stroke: { property: 'stroke', scale: 'colors' },
    },
    space: {
      p: { property: 'padding', scale: 'space' },
      m: { property: 'margin', scale: 'space' },
      gap: { property: 'gap', scale: 'space' },
    },
  };

  it('should resolve theme tokens using prop scales from groups', () => {
    const code = `
      const Card = animus
        .styles({
          backgroundColor: 'colors.background.elevated',
          borderRadius: '8px'
        })
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

    const extracted = extractStylesFromCode(code);
    const usages = extractComponentUsage(usageCode);
    const usageMap = buildUsageMap(usages);

    const result = generator.generateFromExtracted(
      extracted[0],
      groupDefinitions,
      theme,
      usageMap
    );

    // Base styles should resolve theme tokens
    expect(result.css).toContain(
      'background-color: var(--animus-colors-background-elevated)'
    );

    // Atomic utilities should use scale-prefixed paths
    // bg="primary" with scale="colors" → colors.primary
    expect(result.css).toContain('.animus-bg-primary');
    expect(result.css).toMatch(
      /\.animus-bg-primary\s*{\s*background-color:\s*var\(--animus-colors-primary\)/
    );

    // color="text.primary" with scale="colors" → colors.text.primary
    expect(result.css).toContain('.animus-c-textprimary');
    expect(result.css).toMatch(
      /\.animus-c-textprimary\s*{\s*color:\s*var\(--animus-colors-text-primary\)/
    );

    // p="md" with scale="space" → space.md (inlined in hybrid mode)
    expect(result.css).toContain('.animus-p-md');
    expect(result.css).toMatch(/\.animus-p-md\s*{\s*padding:\s*1rem/);

    // CSS variables should be generated
    expect(result.cssVariables).toContain(
      '--animus-colors-background-elevated: #f8f9fa'
    );
    expect(result.cssVariables).toContain('--animus-colors-primary: #007bff');
    expect(result.cssVariables).toContain(
      '--animus-colors-text-primary: #212529'
    );
  });

  it('should handle custom props with scales', () => {
    const code = `
      const Text = animus
        .styles({
          lineHeight: 1.5
        })
        .props({
          textColor: {
            property: 'color',
            scale: 'colors'
          },
          spacing: {
            property: 'letterSpacing',
            scale: 'space'
          }
        })
        .asElement('span');
    `;

    const usageCode = `
      <Text textColor="text.link" spacing="sm">Link text</Text>
    `;

    const extracted = extractStylesFromCode(code);
    const usages = extractComponentUsage(usageCode);
    const usageMap = buildUsageMap(usages);

    const result = generator.generateFromExtracted(
      extracted[0],
      {},
      theme,
      usageMap
    );

    // Custom props should resolve with their scales
    expect(result.css).toContain('.animus-tex-textlink');
    expect(result.css).toMatch(/color:\s*var\(--animus-colors-text-link\)/);

    expect(result.css).toContain('.animus-spa-sm');
    expect(result.css).toMatch(/letter-spacing:\s*0\.5rem/); // space.sm inlined
  });

  it('should not double-prefix when value already contains scale', () => {
    const code = `
      const Box = animus
        .styles({})
        .groups({ color: true })
        .asElement('div');
    `;

    const usageCode = `
      <Box color="colors.primary">Already prefixed</Box>
    `;

    const extracted = extractStylesFromCode(code);
    const usages = extractComponentUsage(usageCode);
    const usageMap = buildUsageMap(usages);

    // Check if extraction found the component
    expect(extracted).toHaveLength(1);
    expect(extracted[0].componentName).toBe('Box');

    const result = generator.generateFromExtracted(
      extracted[0],
      groupDefinitions,
      theme,
      usageMap
    );

    // Should not become colors.colors.primary
    expect(result.css).toMatch(/color:\s*var\(--animus-colors-primary\)/);

    // CSS variables might be merged from multiple sources, so check that it exists
    if (result.cssVariables) {
      expect(result.cssVariables).not.toContain(
        '--animus-colors-colors-primary'
      );
    }
  });
});
