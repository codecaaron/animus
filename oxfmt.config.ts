import { defineConfig } from 'oxfmt';

export default defineConfig({
  sortImports: {
    customGroups: [
      {
        groupName: 'react-libs',
        elementNamePattern: ['react', 'react-**'],
      },
    ],
    groups: [
      'react-libs',
      ['value-builtin', 'value-external'],
      'value-internal',
      ['value-parent', 'value-sibling', 'value-index'],
      'unknown',
    ],
  },
});
