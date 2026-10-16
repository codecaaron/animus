import { eslintCompatPlugin } from '@oxlint/plugins';

import { propOrderRule } from './prop-order';

/** Animus's Oxlint rules, for a consumer's `jsPlugins`. */
const animusPlugin = eslintCompatPlugin({
  meta: { name: 'animus' },
  rules: {
    'prop-order': propOrderRule,
  },
});

export default animusPlugin;
