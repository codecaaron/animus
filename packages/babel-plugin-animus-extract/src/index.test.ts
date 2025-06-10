import { transform } from '@babel/core';

import plugin from './index';

const transformCode = (code: string, options = {}) => {
  const result = transform(code, {
    plugins: [[plugin, options]],
    parserOpts: {
      plugins: ['jsx', 'typescript'],
    },
  });

  return result?.code || '';
};

describe('babel-plugin-animus-extract', () => {
  describe('basic transformation', () => {
    it('should detect animus imports', () => {
      const input = `
        import { animus } from '@animus-ui/core';

        const Box = animus.styles({ padding: 16 }).asElement('div');
      `;

      const output = transformCode(input);

      expect(output).toContain('__animus_runtime');
      expect(output).toContain('Generated CSS');
    });

    it('should transform static styles to CSS', () => {
      const input = `
        import { animus } from '@animus-ui/core';

        const Box = animus
          .styles({
            padding: 16,
            backgroundColor: 'blue',
            margin: '20px'
          })
          .asElement('div');
      `;

      const output = transformCode(input);

      expect(output).toContain('padding: 16px');
      expect(output).toContain('background-color: blue');
      expect(output).toContain('margin: 20px');
    });

    it('should handle states extraction', () => {
      const input = `
        import { animus } from '@animus-ui/core';

        const Button = animus
          .styles({ padding: 10 })
          .states({
            hover: { backgroundColor: 'lightblue' },
            active: { transform: 'scale(0.98)' }
          })
          .asElement('button');
      `;

      const output = transformCode(input);

      expect(output).toContain('--hover');
      expect(output).toContain('background-color: lightblue');
      expect(output).toContain('--active');
      expect(output).toContain('transform: scale(0.98)');
    });
  });

  describe('atomic CSS generation', () => {
    it('should transform JSX props to atomic classes', () => {
      const input = `
        import { animus } from '@animus-ui/core';

        const Box = animus
          .styles({ display: 'flex' })
          .props({
            p: { scale: 'spacing' },
            m: { scale: 'spacing' }
          })
          .asElement('div');

        function App() {
          return <Box p={4} m={2} />;
        }
      `;

      const output = transformCode(input, { atomic: true });

      expect(output).toContain('className="');
      expect(output).toContain('p-4');
      expect(output).toContain('m-2');
    });

    it('should handle responsive props', () => {
      const input = `
        import { animus } from '@animus-ui/core';

        const Box = animus
          .props({
            p: { scale: 'spacing' }
          })
          .asElement('div');

        function App() {
          return <Box p={{ _: 2, md: 4 }} />;
        }
      `;

      const output = transformCode(input, { atomic: true });

      expect(output).toContain('p-2');
      expect(output).toContain('md:p-4');
    });
  });

  describe('development mode', () => {
    it('should skip transformation in development', () => {
      const input = `
        import { animus } from '@animus-ui/core';

        const Box = animus.styles({ padding: 16 }).asElement('div');
      `;

      const output = transformCode(input, { development: true });

      expect(output).not.toContain('__animus_runtime');
      expect(output).toContain('animus.styles');
    });
  });
});
