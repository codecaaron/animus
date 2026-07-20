/**
 * v2 engine loader — the package's only engine and, since
 * retire-extract-v1, its root entry: both `@animus-ui/extract` and the
 * legacy `@animus-ui/extract/engine-v2` subpath resolve here (the subpath
 * is a one-release-cycle alias).
 *
 * Fail-loud contract: a missing binary must produce an actionable
 * error, never a silent fallback
 * (extraction-diagnostics §V2 boundary error reporting).
 */
const { existsSync } = require('fs');
const { join } = require('path');

function loadNative() {
  const { platform, arch } = process;
  const candidates = [
    `animus-extract-v2.${platform}-${arch}.node`,
    `animus-extract-v2.${platform}-${arch}-gnu.node`,
    `animus-extract-v2.${platform}-${arch}-msvc.node`,
  ];
  for (const name of candidates) {
    const p = join(__dirname, 'crates/extract-v2', name);
    if (existsSync(p)) return require(p);
  }
  throw new Error(
    `@animus-ui/extract engine v2: native binary not found for ${platform}-${arch} ` +
      `(looked for ${candidates.join(', ')} under crates/extract-v2/). ` +
      `Published releases ship this binary for darwin-arm64, linux-x64-gnu and ` +
      `linux-arm64-gnu — reinstall the package to restore it (v2 is the only ` +
      `engine; the v1 escape hatch was retired, openspec: retire-extract-v1). ` +
      `In the animus workspace, build it with: vp run build:extract-v2.`
  );
}

module.exports = loadNative();
