// DEF-1 prototype arm T2 — ARTIFACT-FED host: `animus build` runs FIRST
// (separate process); this plugin consumes the published set at .animus/,
// verifies the commit record before transforming (coherence gate,
// fail-loud — never a silent passthrough), and pays T2's real per-process
// cost: the engine transform needs retained state, so hydration re-runs
// the full analysis in the consumer's process. The Turbopack loader
// generalized — including its honestly-measured cost.
import { contentHash } from '@animus-ui/extract/pipeline';
import {
  engineApi,
  ExtractionSession,
  getManifestJson,
  getSessionArtifactDir,
  TURBOPACK_SYSTEM_PROPS_ID,
} from '@animus-ui/extract/session';
import { readFileSync, rmSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const RESOLVED_CSS = '\0animus-t2:styles.css';
const RESOLVED_PROPS = '\0animus-t2:system-props';
const CSS_IMPORT_RE =
  /import\s+['"][^'"]*\.animus\/styles\.css['"];?\n?|import\s+['"]virtual:animus\/styles\.css['"];?\n?/g;

export function animusT2({ root, system, outDir }) {
  const artifacts = outDir ?? join(root, '.animus');
  let stylesCss = '';
  let systemPropsJs = '';
  let sessionDir = null;
  /** Wall-clock of the in-process hydration (the T2 cost under measure). */
  let hydrationMs = 0;

  return {
    name: 'animus-t2',
    async buildStart() {
      // Coherence gate: the published set must verify against its commit
      // record byte-for-byte, or the consumer build FAILS (no passthrough).
      let commit;
      try {
        commit = JSON.parse(
          readFileSync(join(artifacts, 'commit.json'), 'utf-8')
        );
      } catch (error) {
        this.error(
          `[animus-t2] no published artifact set at ${artifacts} — run \`animus build\` first (${error})`
        );
      }
      const payloads = {};
      for (const [name, { hash }] of Object.entries(commit.payloads)) {
        const bytes = readFileSync(join(artifacts, name), 'utf-8');
        if (contentHash(bytes) !== hash) {
          this.error(
            `[animus-t2] ${name} does not match the commit record — stale or torn set; re-run \`animus build\``
          );
        }
        payloads[name] = bytes;
      }
      stylesCss = payloads['styles.css'];
      systemPropsJs = payloads['system-props.js'];

      // T2's hydration cost, measured honestly: the engine transform needs
      // retained in-process state, so the consumer process replays the
      // full analysis (the artifact manifest cannot drive transforms).
      const t0 = performance.now();
      // Emission inputs PINNED (parity discipline): the host and the CLI
      // must agree on mode or their payloads legally differ.
      const session = new ExtractionSession({
        system,
        strict: true,
        mode: 'production',
      });
      session.rootDir = root;
      await session.runFullPipeline();
      sessionDir = getSessionArtifactDir();
      hydrationMs = performance.now() - t0;
      this.warn(
        `[animus-t2] hydration (full re-analysis): ${hydrationMs.toFixed(0)}ms`
      );
    },
    closeBundle() {
      if (sessionDir) rmSync(sessionDir, { recursive: true, force: true });
    },
    resolveId(id) {
      if (id === '.animus/styles.css' || id.endsWith('/.animus/styles.css')) {
        return RESOLVED_CSS;
      }
      if (id === TURBOPACK_SYSTEM_PROPS_ID || id.endsWith('system-props.js')) {
        return RESOLVED_PROPS;
      }
      return null;
    },
    load(id) {
      if (id === RESOLVED_CSS) {
        return `export default ${JSON.stringify(stylesCss)};`;
      }
      if (id === RESOLVED_PROPS) {
        return systemPropsJs;
      }
      return null;
    },
    transform(source, id) {
      if (!/\.(ts|tsx|js|jsx)$/.test(id) || id.startsWith('\0')) return null;
      const filename = relative(root, resolve(id)).split('\\').join('/');
      const { transformFile } = engineApi();
      const result = transformFile(source, filename, getManifestJson() ?? '');
      let code = result.hasComponents ? result.code : source;
      code = code.replace(CSS_IMPORT_RE, '');
      return code === source ? null : { code, map: null };
    },
  };
}
