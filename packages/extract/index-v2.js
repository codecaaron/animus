/**
 * v2 engine loader. The npm surface stays @animus-ui/extract — one
 * package, two engines; plugins select via the `engine` option.
 *
 * Fail-loud contract: a missing binary must produce an actionable
 * error, never a silent fallback to the other engine
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
      `linux-arm64-gnu — reinstall the package, or set engine: 'v1' in the plugin ` +
      `options as the escape hatch (this workspace's fixtures honor ANIMUS_ENGINE=v1). ` +
      `In the animus workspace, build it with: vp run build:extract-v2.`
  );
}

module.exports = loadNative();
