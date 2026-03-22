import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, extname } from 'path';
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
  let manifestCss = '';
  let manifestJson = '';
  let rootDir = '';

  const VIRTUAL_CSS = 'virtual:animus/styles.css';
  const RESOLVED_CSS = '\0virtual:animus/styles.css';

  // Load config using bun (which can handle TS) via a pre-generated JSON
  // We generate this at vite config load time since Vite uses Node, not Bun
  const { execSync } = require('child_process');
  const configData = JSON.parse(execSync(
    `bun -e "const m = require('./tests/fixtures/serialize-config.ts'); console.log(JSON.stringify({c:m.serializedConfig,g:m.serializedGroupRegistry}))"`,
    { cwd: join(__dirname, '../extract'), encoding: 'utf-8' }
  ));
  const serializedConfig = configData.c;
  const serializedGroupRegistry = configData.g;

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

  return {
    name: 'animus-extract-smoke',
    enforce: 'pre' as const,

    configResolved(config: any) {
      rootDir = config.root;
    },

    buildStart() {
      const { analyzeProject } = require(join(__dirname, '../extract/index.js'));

      const exts = new Set(['.tsx', '.ts']);
      const srcDir = join(rootDir, 'src');
      const files = discoverFiles(srcDir, exts);

      const fileEntries = files.map((f: string) => ({
        path: relative(rootDir, f),
        source: readFileSync(f, 'utf-8'),
      }));

      console.log(`[animus] Analyzing ${fileEntries.length} files...`);

      manifestJson = analyzeProject(
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
    },

    resolveId(id: string) {
      if (id === VIRTUAL_CSS) return RESOLVED_CSS;
    },

    load(id: string) {
      if (id === RESOLVED_CSS) return manifestCss;
    },

    transform(code: string, id: string) {
      if (!manifestJson) return null;
      if (!id.endsWith('.tsx') && !id.endsWith('.ts')) return null;

      const { transformFile } = require(join(__dirname, '../extract/index.js'));
      const relativePath = relative(rootDir, id);

      const result = transformFile(code, relativePath, manifestJson);
      if (!result.hasComponents) return null;

      return { code: result.code, map: null };
    },
  };
}
