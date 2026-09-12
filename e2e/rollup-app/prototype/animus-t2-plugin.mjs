// Prototype measurement arm, not the product path: `animus build` publishes
// first and this plugin verifies that set before transforming.
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
  let hydrationMs = 0;

  return {
    name: 'animus-t2',
    async buildStart() {
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

      // The engine transform needs retained in-process state, so the consumer
      // process replays the full analysis; the artifacts cannot drive it.
      const t0 = performance.now();
      // Mode is pinned: host and CLI payloads legally differ otherwise.
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
