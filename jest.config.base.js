const path = require('path');

module.exports = (packageName) => ({
  clearMocks: true,
  verbose: true,
  moduleFileExtensions: [
    'js',
    'json',
    'jsx',
    'node',
    'css',
    'scss',
    'ts',
    'tsx',
    'd.ts',
  ],
  moduleNameMapper: {
    '^@animus\\/core$': '<rootDir>/../core/src',
    '^@codecademy\\/gamut-tests$': '<rootDir>/../gamut-tests/src',
    '^@codecademy\\/variance$': '<rootDir>/../variance/src',
    '^@codecademy\\/gamut-illustrations$':
      '<rootDir>/../gamut-illustrations/src',
    '^@codecademy\\/macros$': '<rootDir>/../macros',
    '^@codecademy\\/gamut-patterns$': '<rootDir>/../gamut-patterns/src',
  },
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  transform: {
    '\\.(j|t)sx?$': [
      'babel-jest',
      {
        configFile: require.resolve(path.join(__dirname, './babel.config.js')),
      },
    ],
  },
  transformIgnorePatterns: ['./disable-transform-ignoring-for-node_modules'],
  testRegex: `packages\\/${packageName}\\/.+(\\.|-)test\\.[jt]sx?$`,
  moduleDirectories: ['node_modules'],
  collectCoverageFrom: ['<rootDir>/**/*.{js,jsx,ts,tsx}'],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/stories/',
    '/vendor/',
    '/dist/',
    '/tmp/',
    '/example/',
    '/typings/',
    '/.storybook/',
  ],
  reporters: process.env.CI ? ['default', 'jest-junit'] : ['default'],
  coverageReporters: ['json', 'text', 'clover'],
});
