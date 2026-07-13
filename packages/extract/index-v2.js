/**
 * v2 engine loader (skeleton). The npm surface stays @animus-ui/extract —
 * one package, two engines; plugins select via the `engine` option.
 *
 * Fail-loud contract: a missing binary or a not-yet-implemented surface
 * function must produce an actionable error, never a silent no-op
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
    `@animus-ui/extract engine v2: native binary not found for ${platform}-${arch}. ` +
      `The v2 engine is under development and not yet distributed in npm releases — ` +
      `use engine: 'v1' (the default). In the animus workspace, build it with: ` +
      `vp run build:extract-v2.`
  );
}

const native = loadNative();

const NOT_IMPLEMENTED = [
  'extract',
  'analyzeProject',
  'transformFile',
  'clearAnalysisCache',
  'loadSystemModule',
];

module.exports = new Proxy(native, {
  get(target, prop) {
    if (prop in target) return target[prop];
    if (NOT_IMPLEMENTED.includes(prop)) {
      throw new Error(
        `@animus-ui/extract engine v2: '${String(prop)}' is not implemented yet ` +
          `(v2 spine lands incrementally behind the parity gate; keep engine: 'v1' ` +
          `until the flip preconditions in openspec/changes/extract-v2-spine are met).`
      );
    }
    return target[prop];
  },
});
