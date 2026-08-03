import { createAppearanceBootstrap } from '@animus-ui/system/bootstrap';
import { animusExtract } from '@animus-ui/vite-plugin';
import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { tokens } from './src/ds';

// Config-time only (openspec: system-color-scheme, D6 — the Vite path is
// plugin-injected opt-in). The generator reads the built theme's declared mode
// names and returns `{ code, cspHash }`; the plugin embeds `code` as an inline
// `<script data-animus-bootstrap>` at the head of the document, before the
// layer style tag and before every stylesheet link.
//
// Nothing under `src/` may import `@animus-ui/system/bootstrap`: the snippet is
// build tooling, and its storage-access code must never reach a client bundle
// (spec: "Bootstrap entry-point isolation"). `scripts/assert-build.ts` pins
// that as a build-output fact.
const appearanceBootstrap = createAppearanceBootstrap(tokens);

export default defineConfig({
  plugins: [
    react(),
    animusExtract({
      system: './src/ds.ts',
      appearanceBootstrap,
      verify: true,
      strict: true,
    }),
    cloudflare(),
  ],
});
