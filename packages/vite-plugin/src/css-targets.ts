import type { LightningTargets } from './css';

// Vite's conversion of `build.cssTarget` into the targets its own Lightning
// CSS minification uses (convertTargets, packages/vite/src/node/plugins/
// css.ts, vite v8.3.4): each browser at the lowest version any entry names.
const BROWSERS = new Map<string, keyof LightningTargets | false>([
  ['chrome', 'chrome'],
  ['edge', 'edge'],
  ['firefox', 'firefox'],
  ['hermes', false],
  ['ie', 'ie'],
  ['ios', 'ios_saf'],
  ['node', false],
  ['opera', 'opera'],
  ['rhino', false],
  ['safari', 'safari'],
]);

const ES_YEARS = new Map<number, string[]>([
  [2015, ['chrome49', 'edge13', 'safari10', 'ios10', 'firefox44', 'opera36']],
  [2016, ['chrome50', 'edge13', 'safari10', 'ios10', 'firefox43', 'opera37']],
  [2017, ['chrome58', 'edge15', 'safari11', 'ios11', 'firefox52', 'opera45']],
  [2018, ['chrome63', 'edge79', 'safari12', 'ios12', 'firefox58', 'opera50']],
  [
    2019,
    ['chrome73', 'edge79', 'safari12.1', 'ios12.1', 'firefox64', 'opera60'],
  ],
  [
    2020,
    ['chrome80', 'edge80', 'safari14.1', 'ios14.5', 'firefox80', 'opera67'],
  ],
  [
    2021,
    ['chrome85', 'edge85', 'safari14.1', 'ios14.5', 'firefox80', 'opera71'],
  ],
  [
    2022,
    ['chrome94', 'edge94', 'safari16.4', 'ios16.4', 'firefox93', 'opera80'],
  ],
  [
    2023,
    ['chrome110', 'edge110', 'safari16.4', 'ios16.4', 'firefox146', 'opera96'],
  ],
  [
    2024,
    ['chrome119', 'edge119', 'safari17.4', 'ios17.4', 'firefox145', 'opera105'],
  ],
  [
    2025,
    ['chrome136', 'edge136', 'safari26.0', 'ios26.0', 'firefox138', 'opera121'],
  ],
]);

/** The Lightning CSS targets Vite's minification uses for `cssTarget`:
 *  none for `false` or `esnext`, which lowers nothing, and `undefined`
 *  where Vite rejects an entry as unsupported. */
export function viteCssTargets(
  cssTarget: string | string[] | false
): LightningTargets | undefined {
  const targets: LightningTargets = {};
  if (cssTarget === false) return targets;
  const entries = [cssTarget].flat().flatMap((entry) => {
    const es = /es(6|\d{4})/.exec(entry);
    if (!es) return [entry];
    return (
      ES_YEARS.get(es[1] === '6' ? 2015 : Number(es[1])) ?? ['unsupported']
    );
  });
  for (const entry of entries) {
    if (entry === 'esnext') continue;
    const index = entry.search(/\d/);
    const browser =
      index >= 0 ? BROWSERS.get(entry.slice(0, index)) : undefined;
    if (browser === false) continue;
    const [major, minor = 0] = entry
      .slice(index)
      .split('.')
      .map((part) => parseInt(part, 10));
    if (browser === undefined || isNaN(major) || isNaN(minor)) return;
    const version = (major << 16) | (minor << 8);
    const lowest = targets[browser];
    if (lowest === undefined || version < lowest) targets[browser] = version;
  }
  return targets;
}
