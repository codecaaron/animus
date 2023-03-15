module.exports = {
  presets: ['codecademy', '@babel/preset-typescript'],
  plugins: [
    '@babel/plugin-proposal-private-methods',
    'macros',
    [
      '@emotion',
      {
        sourceMap: true,
        autoLabel: 'always',
        labelFormat: '[local]',
      },
    ],
  ],
};
