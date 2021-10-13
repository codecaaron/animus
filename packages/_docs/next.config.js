const withTM = require("next-transpile-modules")(["@animus/core"]); // As per comment.
const withPlugins = require("next-compose-plugins");

module.exports = withPlugins([withTM]);
