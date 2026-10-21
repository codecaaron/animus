const { existsSync } = require('fs');
const { join, toNamespacedPath } = require('path');

function loadNative() {
  const { platform, arch } = process;
  const candidates = [
    `animus-extractor.${platform}-${arch}.node`,
    `animus-extractor.${platform}-${arch}-gnu.node`,
    `animus-extractor.${platform}-${arch}-msvc.node`,
  ];
  for (const name of candidates) {
    const p = join(__dirname, 'crates/extractor', name);
    if (existsSync(p)) {
      // What require does for a .node file. A computed require(p) is a
      // module Turbopack traces in a loader and reports as not found.
      const addon = { exports: {} };
      process.dlopen(addon, toNamespacedPath(p));
      return addon.exports;
    }
  }
  throw new Error(
    `@animus-ui/extract: the extractor binary was not found for ${platform}-${arch} ` +
      `(looked for ${candidates.join(', ')} under crates/extractor/). ` +
      `Published releases ship this binary for darwin-arm64, linux-x64-gnu and ` +
      `linux-arm64-gnu — reinstall the package to restore it (the extractor is the only ` +
      `engine, so there is no other engine to fall back to). ` +
      `In the animus workspace, build it with: vp run build:extractor.`
  );
}

module.exports = loadNative();
