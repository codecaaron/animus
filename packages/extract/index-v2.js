const { existsSync } = require('fs');
const { join, toNamespacedPath } = require('path');

function loadNative() {
  const { platform, arch } = process;
  const candidates = [
    `animus-extract-v2.${platform}-${arch}.node`,
    `animus-extract-v2.${platform}-${arch}-gnu.node`,
    `animus-extract-v2.${platform}-${arch}-msvc.node`,
  ];
  for (const name of candidates) {
    const p = join(__dirname, 'crates/extract-v2', name);
    if (existsSync(p)) {
      // What require does for a .node file. A computed require(p) is a
      // module Turbopack traces in a loader and reports as not found.
      const addon = { exports: {} };
      process.dlopen(addon, toNamespacedPath(p));
      return addon.exports;
    }
  }
  throw new Error(
    `@animus-ui/extract engine v2: native binary not found for ${platform}-${arch} ` +
      `(looked for ${candidates.join(', ')} under crates/extract-v2/). ` +
      `Published releases ship this binary for darwin-arm64, linux-x64-gnu and ` +
      `linux-arm64-gnu — reinstall the package to restore it (v2 is the only ` +
      `engine, so there is no other engine to fall back to). ` +
      `In the animus workspace, build it with: vp run build:extract-v2.`
  );
}

module.exports = loadNative();
