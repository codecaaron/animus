import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, extname } from 'path';
import { execSync } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

export default defineConfig({
  plugins: [
    react(),
    animusExtractSmoke(),
  ],
  resolve: {
    alias: {
      '@animus-ui/core': join(__dirname, '../core/src'),
      '@animus-ui/runtime': join(__dirname, '../runtime/src'),
    },
  },
});

// ---------------------------------------------------------------------------
// Minimal inline extraction plugin for the smoke test.
//
// Uses the Rust NAPI addon directly, avoiding workspace package resolution
// issues that arise from importing the full @animus-ui/vite-plugin.
// ---------------------------------------------------------------------------

function discoverFiles(dir: string, exts: Set<string>): string[] {
  const results: string[] = [];
  try {
    for (const entry of readdirSync(dir)) {
      if (['node_modules', 'dist', '.next', 'target'].includes(entry)) continue;
      const full = join(dir, entry);
      try {
        const s = statSync(full);
        if (s.isDirectory()) results.push(...discoverFiles(full, exts));
        else if (exts.has(extname(full))) results.push(full);
      } catch {}
    }
  } catch {}
  return results;
}

function animusExtractSmoke(): any {
  // Load serialized config via Bun subprocess (Node can't handle TS generics in the fixture)
  const extractDir = join(__dirname, '../extract');
  const configJson = execSync(
    `bun -e "const m = require('./tests/fixtures/serialize-config.ts'); process.stdout.write(JSON.stringify({c:m.serializedConfig,g:m.serializedGroupRegistry}))"`,
    { cwd: extractDir, encoding: 'utf-8' }
  );
  const { c: serializedConfig, g: serializedGroupRegistry } = JSON.parse(configJson);

  // Static theme — hardcoded values, no CSS variables, no ThemeProvider needed
  const theme = JSON.stringify({
    'space.0': '0', 'space.4': '0.25rem', 'space.8': '0.5rem',
    'space.12': '0.75rem', 'space.16': '1rem', 'space.24': '1.5rem',
    'space.32': '2rem', 'space.48': '3rem',
    'colors.background': '#ffffff',
    'colors.background-muted': '#f5f5f5',
    'colors.text': '#1a1a1a',
    'colors.primary': '#6366f1',
    'colors.secondary': '#ec4899',
    'colors.transparent': 'transparent',
    'fontWeights.400': '400', 'fontWeights.700': '700',
    'lineHeights.base': '1.6',
    'fonts.base': 'system-ui, -apple-system, sans-serif',
    'fontSizes.14': '0.875rem', 'fontSizes.16': '1rem',
    'fontSizes.30': '1.875rem', 'fontSizes.44': '2.75rem',
    'radii.4': '4px',
    'borders.1': '1px solid currentColor',
    'breakpoints.xs': '480', 'breakpoints.sm': '768',
    'breakpoints.md': '1024', 'breakpoints.lg': '1200', 'breakpoints.xl': '1440',
  });

  // Persistent closure state — survives across HMR cycles
  let manifestCss = '';
  let manifestJson = '';
  let rootDir = '';
  let fileEntries: { path: string; source: string }[] = [];
  let devServer: any = null;

  const VIRTUAL_CSS = 'virtual:animus/styles.css';
  const RESOLVED_CSS = '\0virtual:animus/styles.css';
  const RELEVANT_EXTS = new Set(['.tsx', '.ts', '.jsx', '.js']);

  function runAnalysis() {
    const napi = require(join(extractDir, 'index.js'));

    console.log(`[animus] Analyzing ${fileEntries.length} files...`);

    manifestJson = napi.analyzeProject(
      JSON.stringify(fileEntries),
      theme,
      serializedConfig,
      serializedGroupRegistry,
      '{}',
    );

    const manifest = JSON.parse(manifestJson);
    manifestCss = manifest.css || '';

    console.log(`[animus] ${Object.keys(manifest.components).length} components, ${manifestCss.length} chars CSS`);
    if (manifest.report) {
      console.log(`[animus] Extracted: ${manifest.report.components_extracted}, Eliminated: ${manifest.report.components_eliminated}`);
    }
  }

  return {
    name: 'animus-extract-smoke',
    enforce: 'pre' as const,

    configResolved(config: any) {
      rootDir = config.root;
    },

    configureServer(server: any) {
      devServer = server;
    },

    buildStart() {
      // Discover and read all source files
      const files = discoverFiles(join(rootDir, 'src'), RELEVANT_EXTS);
      fileEntries = files.map((f: string) => ({
        path: relative(rootDir, f),
        source: readFileSync(f, 'utf-8'),
      }));

      // Run initial analysis
      runAnalysis();
    },

    handleHotUpdate({ file }: { file: string }) {
      // Only re-analyze for relevant source files
      if (!RELEVANT_EXTS.has(extname(file))) return;

      const relativePath = relative(rootDir, file);
      const newSource = readFileSync(file, 'utf-8');

      // Update the stored file entry
      const idx = fileEntries.findIndex(e => e.path === relativePath);
      if (idx >= 0) {
        fileEntries[idx].source = newSource;
      } else {
        // New file added
        fileEntries.push({ path: relativePath, source: newSource });
      }

      // Re-analyze with updated sources
      runAnalysis();

      // Invalidate the CSS virtual module so Vite re-serves it
      if (devServer) {
        const cssModule = devServer.moduleGraph.getModuleById(RESOLVED_CSS);
        if (cssModule) {
          devServer.moduleGraph.invalidateModule(cssModule);
        }
        // Full reload to pick up new CSS + transformed source
        devServer.ws.send({ type: 'full-reload' });
      }
    },

    resolveId(id: string) {
      if (id === VIRTUAL_CSS) return RESOLVED_CSS;
    },

    load(id: string) {
      if (id === RESOLVED_CSS) return manifestCss;
    },

    transform(code: string, id: string) {
      if (!manifestJson) return null;
      if (!RELEVANT_EXTS.has(extname(id))) return null;

      const napi = require(join(extractDir, 'index.js'));
      const relativePath = relative(rootDir, id);
      const result = napi.transformFile(code, relativePath, manifestJson);

      if (!result.hasComponents) return null;
      return { code: result.code, map: null };
    },
  };
}
