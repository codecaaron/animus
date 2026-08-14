// DEF-1 prototype arm T0 — IN-PROCESS host: the ONE ExtractionSession runs
// at buildStart inside the consumer's rollup process (no artifacts, no
// second process); per-file transforms come from the retained engine state
// via the singleton engine API. The Vite plugin generalized, not the
// Turbopack loader generalized.
import {
  engineApi,
  ExtractionSession,
  getManifestJson,
  getSessionArtifactDir,
  getSharedCss,
  getSharedSystemProps,
  TURBOPACK_SYSTEM_PROPS_ID,
} from '@animus-ui/extract/session';
import { rmSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const CSS_ID = '.animus/styles.css';
const RESOLVED_CSS = '\0animus-t0:styles.css';
const RESOLVED_PROPS = '\0animus-t0:system-props';
const CSS_IMPORT_RE =
  /import\s+['"][^'"]*\.animus\/styles\.css['"];?\n?|import\s+['"]virtual:animus\/styles\.css['"];?\n?/g;

export function animusT0({ root, system }) {
  let sessionDir = null;
  return {
    name: 'animus-t0',
    async buildStart() {
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
    },
    closeBundle() {
      if (sessionDir) rmSync(sessionDir, { recursive: true, force: true });
    },
    resolveId(id) {
      if (id === CSS_ID || id.endsWith('/.animus/styles.css')) {
        return RESOLVED_CSS;
      }
      if (id === TURBOPACK_SYSTEM_PROPS_ID || id.endsWith('system-props.js')) {
        return RESOLVED_PROPS;
      }
      return null;
    },
    load(id) {
      if (id === RESOLVED_CSS) {
        // CSS-as-string module: the render gate reads the sheet from the
        // bundle; a real host would emit a CSS asset instead.
        return `export default ${JSON.stringify(getSharedCss())};`;
      }
      if (id === RESOLVED_PROPS) {
        return getSharedSystemProps();
      }
      return null;
    },
    transform(source, id) {
      if (!/\.(ts|tsx|js|jsx)$/.test(id) || id.startsWith('\0')) return null;
      const filename = relative(root, resolve(id)).split('\\').join('/');
      const { transformFile } = engineApi();
      const result = transformFile(source, filename, getManifestJson() ?? '');
      let code = result.hasComponents ? result.code : source;
      // One stylesheet import for the whole bundle: strip everywhere, the
      // entry re-imports explicitly.
      code = code.replace(CSS_IMPORT_RE, '');
      return code === source ? null : { code, map: null };
    },
  };
}
