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
    '^@animus\\/ui$': '<rootDir>/../ui/src',
    '^@animus\\/elements$': '<rootDir>/../elements/src',
    '^@animus\\/props$': '<rootDir>/../props/src',
    '^@animus\\/provider$': '<rootDir>/../provider/src',
    '^@animus\\/theme$': '<rootDir>/../theme/src',
    '^@animus\\/theming$': '<rootDir>/../theming/src',
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
