import { describe, expect, it } from 'vitest';

import type { ComponentUsage, UsageMap } from '../usageCollector';
import { buildUsageMap, extractComponentUsage } from '../usageCollector';

describe('[QUANTUM] Cross-File Usage Collection - String-Based Pattern Tracking', () => {
  describe('Basic Usage Extraction', () => {
    it('should extract simple prop usage from JSX code', () => {
      const code = `
        import { Button } from './Button';
        export const App = () => (
          <Button p={4} m={2}>Click me</Button>
        );
      `;

      const usages = extractComponentUsage(code);

      expect(usages).toHaveLength(1);
      expect(usages[0].componentName).toBe('Button');
      expect(usages[0].props.p).toBe(4);
      expect(usages[0].props.m).toBe(2);
    });

    it('should extract multiple component usages', () => {
      const code = `
        import { Button, Card } from './components';
        
        export const Page = () => (
          <div>
            <Card p={2} elevated>
              <Button size="small" variant="primary" />
              <Button size="large" variant="secondary" />
            </Card>
          </div>
        );
      `;

      const usages = extractComponentUsage(code);

      expect(usages).toHaveLength(3);

      const cardUsage = usages.find((u) => u.componentName === 'Card');
      expect(cardUsage?.props.p).toBe(2);
      expect(cardUsage?.props.elevated).toBe(true);

      const buttonUsages = usages.filter((u) => u.componentName === 'Button');
      expect(buttonUsages).toHaveLength(2);
    });
  });

  describe('Responsive Value Extraction', () => {
    it('should handle array responsive values', () => {
      const code = `
        export const Layout = () => (
          <Box p={[1, 2, 3]} m={[0, , 4]}>
            Content
          </Box>
        );
      `;

      const usages = extractComponentUsage(code);
      const usageMap = buildUsageMap(usages);

      const boxUsage = usageMap.Box;
      expect(boxUsage.p).toEqual(new Set(['1:_', '2:xs', '3:sm']));
      expect(boxUsage.m).toEqual(new Set(['0:_', '4:xs']));
    });

    it('should handle object responsive values', () => {
      const code = `
        export const Page = () => (
          <Card p={{ _: 2, sm: 4, lg: 6 }}>
            Content
          </Card>
        );
      `;

      const usages = extractComponentUsage(code);
      const usageMap = buildUsageMap(usages);

      const cardUsage = usageMap.Card;
      expect(cardUsage.p).toEqual(new Set(['2:_', '4:sm', '6:lg']));
    });
  });

  describe('Usage Map Building', () => {
    it('should aggregate multiple usages of same component', () => {
      const code = `
        export const App = () => (
          <>
            <Button p={2} m={1} variant="primary" />
            <Button p={4} m={1} variant="secondary" />
            <Button p={2} m={2} variant="primary" />
          </>
        );
      `;

      const usages = extractComponentUsage(code);
      const usageMap = buildUsageMap(usages);

      expect(usageMap.Button).toBeDefined();
      expect(usageMap.Button.p).toEqual(new Set(['2:_', '4:_']));
      expect(usageMap.Button.m).toEqual(new Set(['1:_', '2:_']));
      expect(usageMap.Button.variant).toEqual(
        new Set(['primary:_', 'secondary:_'])
      );
    });

    it('should handle mixed component types', () => {
      const code = `
        export const Dashboard = () => (
          <>
            <Header bg="primary" p={2} />
            <Card m={[1, 2]} elevated />
            <Button size="large" />
            <Card m={3} />
          </>
        );
      `;

      const usages = extractComponentUsage(code);
      const usageMap = buildUsageMap(usages);

      expect(Object.keys(usageMap)).toEqual(['Header', 'Card', 'Button']);

      expect(usageMap.Header.bg).toEqual(new Set(['primary:_']));
      expect(usageMap.Card.m).toEqual(new Set(['1:_', '2:xs', '3:_']));
      expect(usageMap.Button.size).toEqual(new Set(['large:_']));
    });
  });

  describe('Special Prop Handling', () => {
    it('should handle boolean props', () => {
      const code = `
        export const Form = () => (
          <>
            <Input disabled />
            <Button loading disabled={false} />
            <Card elevated={true} />
          </>
        );
      `;

      const usages = extractComponentUsage(code);

      expect(usages[0].props.disabled).toBe(true);
      expect(usages[1].props.loading).toBe(true);
      expect(usages[1].props.disabled).toBe(false);
      expect(usages[2].props.elevated).toBe(true);
    });

    it('should handle string literals and numbers', () => {
      const code = `
        export const Stats = () => (
          <Box
            width="100%"
            height={200}
            opacity={0.8}
            zIndex={10}
            position="relative"
          />
        );
      `;

      const usages = extractComponentUsage(code);
      const props = usages[0].props;

      expect(props.width).toBe('100%');
      expect(props.height).toBe(200);
      expect(props.opacity).toBe(0.8);
      expect(props.zIndex).toBe(10);
      expect(props.position).toBe('relative');
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle nested components', () => {
      const code = `
        export const ComplexLayout = () => (
          <Container p={4}>
            <Header>
              <Logo size="small" />
              <Nav>
                <NavItem active>Home</NavItem>
                <NavItem>About</NavItem>
              </Nav>
            </Header>
            <Main>
              <Card elevated m={2}>
                Content
              </Card>
            </Main>
          </Container>
        );
      `;

      const usages = extractComponentUsage(code);
      const usageMap = buildUsageMap(usages);

      expect(Object.keys(usageMap).sort()).toEqual(
        ['Card', 'Container', 'Header', 'Logo', 'Main', 'Nav', 'NavItem'].sort()
      );

      expect(usageMap.NavItem.active).toEqual(new Set(['true:_']));
    });

    it('should handle fragments and conditional rendering', () => {
      const code = `
        export const ConditionalUI = ({ show }) => (
          <>
            {show && <Alert type="warning" m={2} />}
            {show ? (
              <Button variant="primary">Save</Button>
            ) : (
              <Button variant="secondary">Cancel</Button>
            )}
          </>
        );
      `;

      const usages = extractComponentUsage(code);
      const usageMap = buildUsageMap(usages);

      expect(usageMap.Alert?.type).toEqual(new Set(['warning:_']));
      expect(usageMap.Button?.variant).toEqual(
        new Set(['primary:_', 'secondary:_'])
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty props', () => {
      const code = `
        export const Simple = () => (
          <>
            <Button />
            <Card></Card>
          </>
        );
      `;

      const usages = extractComponentUsage(code);

      expect(usages).toHaveLength(2);
      expect(usages[0].props).toEqual({});
      expect(usages[1].props).toEqual({});
    });

    it('should ignore non-JSX elements', () => {
      const code = `
        export const Mixed = () => {
          const data = { button: 'text' };
          
          return (
            <>
              <Button p={2} />
              <div className="native" />
              <span>Text</span>
            </>
          );
        };
      `;

      const usages = extractComponentUsage(code);

      // Should only extract custom components (capitalized)
      expect(usages).toHaveLength(1);
      expect(usages[0].componentName).toBe('Button');
    });

    it('should handle spread props gracefully', () => {
      const code = `
        export const SpreadExample = () => {
          const props = { p: 4, m: 2 };
          
          return (
            <>
              <Box {...props} bg="primary" />
              <Card {...props} />
            </>
          );
        };
      `;

      const usages = extractComponentUsage(code);

      // Can only extract static props, not spread
      expect(usages[0].props).toEqual({ bg: 'primary' });
      expect(usages[1].props).toEqual({});
    });
  });
});
