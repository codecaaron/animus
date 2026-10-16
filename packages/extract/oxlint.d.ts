/** Animus's Oxlint JS plugin, for a config's `jsPlugins`: its one rule is
 *  `prop-order`. Its CommonJS build exports the plugin as the module. */
declare const animusPlugin: {
  meta: { name: 'animus' };
  rules: { 'prop-order': object };
};

export = animusPlugin;
