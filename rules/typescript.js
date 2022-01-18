const override = {
  extends: ['plugin:@typescript-eslint/recommended-requiring-type-checking'],
  files: ['*.ts', '*.tsx'],
  parser: require.resolve('@typescript-eslint/parser'),
  parserOptions: {
    project: './tsconfig.json',
    sourceType: 'module',
  },

  rules: {
    '@typescript-eslint/non-nullable-type-assertion-style': 'error',
    '@typescript-eslint/prefer-optional-chain': 'error',
  },
};

const nextjs = {
  plugins: ['react'],
  files: [
    './packages/_docs/**/*.ts',
    './packages/_docs/**/*.tsx',
    '*.test.tsx',
  ],
  rules: { 'react/react-in-jsx-scope': 'off' },
};

module.exports = { overrides: [override, nextjs] };
