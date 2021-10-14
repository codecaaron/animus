const withTM = require('next-transpile-modules')([
  '@animus/core',
  '@animus/theme',
  '@animus/theming',
  '@animus/ui',
  '@animus/provider',
  '@animus/elements',
]); // As per comment.
const withPlugins = require('next-compose-plugins');

module.exports = withPlugins([withTM]);
