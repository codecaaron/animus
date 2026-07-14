# Increment 04: Vinext Hybrid-Router Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` or `superpowers:executing-plans` to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking. Run no version-control command.

**Goal:** Add a self-contained Vinext App+Pages Router extraction canary that
builds for Worker `animus-vinext-canary` and proves the coordinated Vinext beta
graph at runtime-build depth.

**Architecture:** One app-local Animus system and three routes exercise an RSC
page, a client boundary, and Pages Router SSR. Vinext owns Next-compatible
routing and RSC setup; Cloudflare's Vite plugin runs the `rsc` environment in
workerd. The Animus plugin remains one unadapted instance so this build supplies
evidence for the later multi-environment decision.

**Tech Stack:** Vinext 1.0.0-beta.1, React 19.2.7, Vite 8.1.4, Cloudflare Vite
plugin 1.44.0, Animus Vite plugin, Wrangler 4.110.0, Vitest.

---

## Scope

- **Registry row**: 04 · mode: inline · review: subagent
- **Resolves**: DEF-3, D3 Vinext adapter leg, D5 hybrid fixture
- **Depends on**: increment 01 / D9
- **Footprint**: `e2e/vinext-app/**` except `e2e/vinext-app/package.json`, this
  packet
- **Pushes later**: root orchestration belongs to row 06; DEF-2/any Animus
  multi-environment adaptation belongs to row 05; remote state belongs to 2.1.
- **Prohibitions**: do not edit package dependencies, another e2e app, library
  code, root config, or shared OpenSpec artifacts. Do not add React aliases,
  deploy remotely, or run Git commands.

## Context capsule

- D9 locked the exact graph and accepted one upstream metadata exception:
  `@vinext/cloudflare@1.0.0-beta.1` declares `vinext >=0.0.0`, which excludes
  prereleases even though the exact matching beta resolves. This increment's
  production build is the required functional proof.
- The installed Vinext beta's `init-cloudflare` generator composes `vinext()`
  with `cloudflare({ viteEnvironment: { name: 'rsc', childEnvironments:
  ['ssr'] } })`; Vinext owns its RSC plugin internally. Do not add a second
  explicit `rsc()` instance.
- Worker identity is `animus-vinext-canary`; compatibility date `2026-07-14`;
  `nodejs_compat` is required by Vinext's generated Cloudflare config.
- The app must never import `e2e/next-app`; its files are self-contained.

## Task 04.1: Add a failing structural contract

- [x] **Step 1:** Create `e2e/vinext-app/scripts/config.test.ts`.

  ```ts
  import { existsSync, readFileSync } from 'node:fs';
  import { resolve } from 'node:path';
  import { describe, expect, it } from 'vitest';

  const ROOT = resolve(import.meta.dirname, '..');

  function source(path: string): string {
    const absolute = resolve(ROOT, path);
    expect(existsSync(absolute), `${path} must exist`).toBe(true);
    return readFileSync(absolute, 'utf8');
  }

  describe('Vinext canary structure', () => {
    it.each([
      'app/layout.tsx',
      'app/page.tsx',
      'app/client/page.tsx',
      'pages/_app.tsx',
      'pages/legacy.tsx',
      'src/ds.ts',
      'src/components.tsx',
      'vite.config.ts',
      'wrangler.jsonc',
    ])('owns %s', (path) => {
      source(path);
    });

    it('composes Vinext, one Animus plugin, and Cloudflare RSC workerd', () => {
      const config = source('vite.config.ts');
      expect(config.match(/vinext\(/g)).toHaveLength(1);
      expect(config.match(/animusExtract\(/g)).toHaveLength(1);
      expect(config.match(/cloudflare\(/g)).toHaveLength(1);
      expect(config).toContain("name: 'rsc'");
      expect(config).toContain("childEnvironments: ['ssr']");
      expect(config).not.toMatch(/\brsc\s*\(/);
    });

    it('owns the exact Worker identity and Vinext entry', () => {
      const config = JSON.parse(source('wrangler.jsonc')) as {
        name?: string;
        main?: string;
        compatibility_flags?: string[];
        assets?: Record<string, unknown>;
      };
      expect(config).toMatchObject({
        name: 'animus-vinext-canary',
        main: 'vinext/server/fetch-handler',
        compatibility_flags: ['nodejs_compat'],
        assets: {
          directory: 'dist/client',
          not_found_handling: 'none',
          binding: 'ASSETS',
        },
      });
    });

    it('contains no cross-fixture imports', () => {
      for (const path of [
        'app/layout.tsx',
        'app/page.tsx',
        'app/client/page.tsx',
        'pages/_app.tsx',
        'pages/legacy.tsx',
        'src/ds.ts',
        'src/components.tsx',
      ]) {
        expect(source(path)).not.toMatch(/e2e\/(next|vite|react-router)-app/);
      }
    });
  });
  ```

- [x] **Step 2:** Run RED.

  ```bash
  bunx vp test run e2e/vinext-app/scripts/config.test.ts
  ```

  Expected: failures name the absent app/config files; no syntax/import failure.

## Task 04.2: Create the self-contained Animus fixture

- [x] **Step 1:** Create `e2e/vinext-app/src/ds.ts`.

  ```ts
  import { createSystem, createTheme } from '@animus-ui/system';
  import { border, color, flex, layout, space, typography } from '@animus-ui/system/groups';
  import { ds as testDs } from '@animus-ui/test-ds';

  export const tokens = createTheme()
    .addColors({
      blue: { 100: '#dbeafe', 500: '#3b82f6', 700: '#1d4ed8' },
      gray: { 100: '#f5f5f5', 500: '#737373', 800: '#262626', 950: '#0a0a0a' },
      red: { 500: '#ef4444', 700: '#b91c1c' },
    })
    .addColorModes('dark', {
      dark: {
        primary: { _: 'blue.500', hover: 'blue.700' },
        danger: 'red.500',
        background: 'gray.950',
        surface: 'gray.800',
        text: { _: 'gray.100', muted: 'gray.500' },
        border: 'gray.500',
      },
      light: {
        primary: { _: 'blue.700', hover: 'blue.500' },
        danger: 'red.700',
        background: 'gray.100',
        surface: 'gray.100',
        text: { _: 'gray.950', muted: 'gray.500' },
        border: 'gray.500',
      },
    })
    .addScale({
      name: 'space',
      values: { 0: '0', 4: '0.25rem', 8: '0.5rem', 16: '1rem', 24: '1.5rem', 32: '2rem' },
    })
    .addScale({
      name: 'fontSizes',
      values: { 14: '0.875rem', 16: '1rem', 24: '1.5rem', 32: '2rem' },
    })
    .build();

  export type VinextTheme = typeof tokens;

  declare module '@animus-ui/system' {
    interface Theme extends VinextTheme {}
  }

  export const { system: ds, createGlobalStyles } = createSystem({
    includes: [testDs],
  })
    .addGroup('space', space)
    .addGroup('layout', { ...layout, ...flex })
    .addGroup('text', typography)
    .addGroup('surface', { ...color, ...border })
    .build();

  export const globalStyles = createGlobalStyles({
    '*, *::before, *::after': { boxSizing: 'border-box' },
    body: {
      m: 0,
      bg: 'background',
      color: 'text',
      fontFamily: 'system-ui, sans-serif',
    },
  });
  ```

- [x] **Step 2:** Create `e2e/vinext-app/src/components.tsx`.

  ```tsx
  import { ds } from './ds';

  export const Stack = ds
    .styles({ display: 'flex', flexDirection: 'column', gap: 16 })
    .variant({
      prop: 'direction',
      defaultVariant: 'column',
      variants: {
        column: { flexDirection: 'column' },
        row: { flexDirection: 'row', alignItems: 'center' },
      },
    })
    .system({ space: true, layout: true })
    .asElement('div');

  export const Button = ds
    .styles({
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      border: 'none',
      cursor: 'pointer',
      fontWeight: 600,
    })
    .variant({
      prop: 'intent',
      defaultVariant: 'primary',
      variants: {
        primary: { bg: 'primary', color: 'background' },
        danger: { bg: 'danger', color: 'background' },
        ghost: { bg: 'surface', color: 'text' },
      },
    })
    .variant({
      prop: 'size',
      defaultVariant: 'medium',
      variants: {
        small: { fontSize: 14, px: 8, py: 4 },
        medium: { fontSize: 16, px: 16, py: 8 },
        large: { fontSize: 24, px: 24, py: 16 },
      },
    })
    .states({ hover: { opacity: '0.85' } })
    .asElement('button');

  export const Panel = ds
    .styles({ border: '1px solid', borderColor: 'border', bg: 'surface', p: 24 })
    .variant({
      prop: 'tone',
      defaultVariant: 'neutral',
      variants: {
        neutral: { color: 'text' },
        danger: { color: 'danger' },
      },
    })
    .asElement('section');
  ```

## Task 04.3: Add App Router RSC and client routes

- [x] **Step 1:** Create `e2e/vinext-app/app/layout.tsx`.

  ```tsx
  import type { ReactNode } from 'react';
  import 'virtual:animus/styles.css';

  export const metadata = { title: 'Animus Vinext Canary' };

  export default function RootLayout({ children }: { children: ReactNode }) {
    return (
      <html lang="en">
        <body>{children}</body>
      </html>
    );
  }
  ```

- [x] **Step 2:** Create `e2e/vinext-app/app/page.tsx`.

  ```tsx
  import { Button as PackageButton, Card as PackageCard } from '@animus-ui/test-ds';

  import { Button, Panel, Stack } from '../src/components';

  export default function Home() {
    return (
      <Stack p={32} gap={24}>
        <h1>Vinext RSC canary</h1>
        <p>App Router server component rendered through workerd.</p>
        <Stack direction="row" gap={8}>
          <Button intent="primary" size="small">Primary</Button>
          <Button intent="danger" size="large">Danger</Button>
        </Stack>
        <Panel tone="neutral">
          <PackageButton variant="primary" px={24} py={8}>Package component</PackageButton>
          <PackageCard>External design-system package</PackageCard>
        </Panel>
      </Stack>
    );
  }
  ```

- [x] **Step 3:** Create `e2e/vinext-app/app/client/page.tsx`.

  ```tsx
  'use client';

  import { useState } from 'react';

  import { Button, Panel, Stack } from '../../src/components';

  const intents = ['primary', 'danger', 'ghost'] as const;

  export default function ClientPage() {
    const [index, setIndex] = useState(0);
    const intent = intents[index % intents.length];

    return (
      <Stack p={32} gap={16}>
        <h1>Vinext client boundary canary</h1>
        <Button intent={intent} onClick={() => setIndex((value) => value + 1)}>
          Intent: {intent}
        </Button>
        <Panel tone={intent === 'danger' ? 'danger' : 'neutral'}>
          Hydrated interaction count: {index}
        </Panel>
      </Stack>
    );
  }
  ```

## Task 04.4: Add Pages Router SSR

- [x] **Step 1:** Create `e2e/vinext-app/pages/_app.tsx`.

  ```tsx
  import type { ComponentType } from 'react';
  import 'virtual:animus/styles.css';

  export default function App({
    Component,
    pageProps,
  }: {
    Component: ComponentType<Record<string, unknown>>;
    pageProps: Record<string, unknown>;
  }) {
    return <Component {...pageProps} />;
  }
  ```

- [x] **Step 2:** Create `e2e/vinext-app/pages/legacy.tsx`.

  ```tsx
  import { Button as PackageButton } from '@animus-ui/test-ds';

  import { Button, Panel, Stack } from '../src/components';

  export default function LegacyPage() {
    return (
      <Stack p={32} gap={24}>
        <h1>Vinext Pages Router canary</h1>
        <p>Traditional SSR route rendered by Vinext.</p>
        <Stack direction="row" gap={8}>
          <Button intent="ghost" size="medium">Ghost</Button>
          <PackageButton variant="secondary" px={24} py={8}>Package secondary</PackageButton>
        </Stack>
        <Panel tone="danger">Pages Router extraction evidence</Panel>
      </Stack>
    );
  }
  ```

## Task 04.5: Configure Vinext, TypeScript, and Worker ownership

- [x] **Step 1:** Create `e2e/vinext-app/vite.config.ts`.

  ```ts
  import { cloudflare } from '@cloudflare/vite-plugin';
  import { animusExtract } from '@animus-ui/vite-plugin';
  import { defineConfig } from 'vite';
  import vinext from 'vinext';

  export default defineConfig({
    plugins: [
      vinext(),
      animusExtract({
        system: './src/ds.ts',
        verify: true,
        strict: true,
        engine: process.env.ANIMUS_ENGINE === 'v1' ? 'v1' : 'v2',
      }),
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
      }),
    ],
  });
  ```

- [x] **Step 2:** Create `e2e/vinext-app/wrangler.jsonc`.

  ```json
  {
    "$schema": "../../node_modules/wrangler/config-schema.json",
    "name": "animus-vinext-canary",
    "compatibility_date": "2026-07-14",
    "compatibility_flags": ["nodejs_compat"],
    "main": "vinext/server/fetch-handler",
    "assets": {
      "directory": "dist/client",
      "not_found_handling": "none",
      "binding": "ASSETS"
    }
  }
  ```

- [x] **Step 3:** Create `e2e/vinext-app/next.config.ts`.

  ```ts
  const config = { reactStrictMode: true };

  export default config;
  ```

- [x] **Step 4:** Create `e2e/vinext-app/tsconfig.json`.

  ```json
  {
    "compilerOptions": {
      "target": "ES2022",
      "lib": ["DOM", "DOM.Iterable", "ESNext"],
      "strict": true,
      "noEmit": true,
      "skipLibCheck": true,
      "esModuleInterop": true,
      "module": "ESNext",
      "moduleResolution": "Bundler",
      "resolveJsonModule": true,
      "isolatedModules": true,
      "jsx": "preserve",
      "types": ["vite/client"]
    },
    "include": ["app/**/*.ts", "app/**/*.tsx", "pages/**/*.ts", "pages/**/*.tsx", "src/**/*.ts", "src/**/*.tsx", "styles.d.ts", "vite.config.ts"],
    "exclude": ["node_modules", "dist"]
  }
  ```

- [x] **Step 5:** Create `e2e/vinext-app/styles.d.ts`.

  ```ts
  declare module 'virtual:animus/styles.css';
  ```

- [x] **Step 6:** Re-run the structural test.

  ```bash
  bunx vp test run e2e/vinext-app/scripts/config.test.ts
  ```

  Expected: all cases pass.

## Task 04.6: Add and run post-build assertions

- [x] **Step 1:** Create `e2e/vinext-app/scripts/assert-build.ts`.

  ```ts
  import {
    AssertionError,
    assertClassNameFormat,
    assertLayerOrder,
    assertNoEmotionImports,
    assertNoPlaceholders,
    findCssFiles,
    findJsFiles,
    layerBlock,
    readAllConcat,
  } from '@animus-ui/assertions';
  import { readFile } from 'node:fs/promises';
  import { resolve } from 'node:path';

  const DIST = resolve(import.meta.dirname, '..', 'dist');

  async function main(): Promise<void> {
    const cssFiles = await findCssFiles(DIST);
    if (cssFiles.length === 0) {
      throw new AssertionError(`No CSS file found under ${DIST}`);
    }
    const css = await readAllConcat(cssFiles);
    assertLayerOrder(css, {
      layers: [layerBlock('anm-base'), layerBlock('anm-variants')],
    });
    if (!css.includes(':root')) {
      throw new AssertionError('Expected a :root variable block in Vinext CSS');
    }
    assertNoPlaceholders(css);

    const jsFiles = await findJsFiles(DIST);
    const js = await readAllConcat(jsFiles);
    assertClassNameFormat(`${css}\n${js}`, { prefix: 'animus-' });
    if (!js.includes('Vinext RSC canary')) {
      throw new AssertionError('App Router RSC marker missing from build');
    }
    if (!js.includes('Vinext Pages Router canary')) {
      throw new AssertionError('Pages Router marker missing from build');
    }
    for (const file of jsFiles) {
      assertNoEmotionImports(await readFile(file, 'utf8'));
    }

    console.log(
      `[vinext-app:assert] ${cssFiles.length} CSS file(s), ${jsFiles.length} JS file(s), App+Pages routers present — all assertions passed`
    );
  }

  main().catch((error) => {
    console.error('[vinext-app:assert] FAIL:', error);
    process.exit(1);
  });
  ```

- [x] **Step 2:** Run Vinext compatibility and TypeScript checks.

  ```bash
  bun run --filter @animus-ui/vinext-app check
  bunx tsgo -p e2e/vinext-app/tsconfig.json --noEmit
  ```

  Expected: both exit 0 with no unsupported hybrid-router finding.

- [x] **Step 3:** Build the production Worker.

  ```bash
  bun run --filter @animus-ui/vinext-app build
  ```

  Expected: RSC, SSR, and client environments finish; no Animus state-collision,
  transform-drift, missing-style, or strict extraction error. If such a symptom
  appears, stop and surface it for DEF-2 rather than editing library code.

- [x] **Step 4:** Run the build assertion.

  ```bash
  bun e2e/vinext-app/scripts/assert-build.ts
  ```

  Expected: emitted CSS/class/layer and App+Pages markers all pass.

- [x] **Step 5:** Run the deployment dry run and preserve the native oracle.

  ```bash
  bun run --filter @animus-ui/vinext-app cf:dry-run
  vp run verify:next
  ```

  Expected: Vinext Worker bundle/assets dry-run exits 0 without auth; native
  Next build/assert remains green.

## Guardrail gate

- [x] G1 native Next plugin retained:
  `rg -n -F '"@animus-ui/next-plugin": "workspace:*"' e2e/next-app/package.json`
- [x] G2 no root config: `test ! -e wrangler.jsonc`
- [x] G3 no duplicate names:
  `rg --glob 'wrangler.jsonc' -o '"name"[[:space:]]*:[[:space:]]*"[^"]+"' e2e packages | sed -E 's/.*"name"[[:space:]]*:[[:space:]]*"([^"]+)"/\1/' | sort | uniq -d`
- [x] G4 no packages→e2e imports:
  `rg -n "from ['\"][^'\"]*e2e/" packages`
- [x] G5 no token values:
  `rg -n --glob '*.json' --glob '*.jsonc' --glob '*.toml' '(CLOUDFLARE_API_TOKEN|CF_API_TOKEN).*[A-Za-z0-9_-]{20,}' e2e packages`
- [x] Cross-fixture isolation:
  `rg -n 'e2e/(next|vite|react-router)-app' e2e/vinext-app`

Expected: G1/G2 succeed; all other scans output empty.

## Output contract

- [x] Tick only completed packet checkboxes.
- [x] Record structural RED/GREEN, check/typecheck/build/assert/dry-run/native
  Next results.
- [x] State whether hybrid App+Pages resolves DEF-3 positively or negatively.
- [x] State whether the build surfaces a DEF-2 multi-environment signal; include
  exact diagnostics if it does.
- [x] State whether the D9 Vinext peer-metadata exception is functionally proven.
- [x] Proposed journal signal/review/surprise entries and surfaced variables.
- [x] Do not edit `design.md`, `tasks.md`, `journal.md`, or `specs/**`.

## Implementation record

- **Structural TDD:** the RED run failed all 12 original cases only because the
  owned fixture files were absent. After implementation and JSONC-aware parsing,
  the expanded contract passes alongside the hydration test: 2 files and 15
  tests green.
- **Compatibility and types:** `vinext check` exits 0, recognizes one Pages
  route, a custom `_app`, two App routes, and one layout, and reports 93%
  compatible with zero issues. Its only partial item is the upstream beta's
  documented `reactStrictMode` behavior for App Router. `tsgo --noEmit` exits 0.
- **Production build:** all five Vinext phases plus the hybrid Pages server exit
  0. The single `[FILE_NAME_CONFLICT]` warning is an identical hashed CSS asset
  emitted twice by the beta; extraction emits no state collision, transform
  drift, missing-style, or strict-mode diagnostic.
- **Artifact proof:** `assert-build.ts` passes across 4 CSS and 80 JavaScript
  files, including layer order, variables, placeholders, class format, App and
  Pages markers, and no Emotion imports. Wrangler's redirected dry run exits 0
  with 48 modules, 42 client assets, and the `ASSETS` binding.
- **Runtime proof:** local workerd returns 200 HTML for `/`, `/client`, and
  `/legacy`; each response contains its route marker and an Animus class. The
  React 19 `hydrateRoot` fallback test advances `Intent: primary` to
  `Intent: danger` and count 0 to 1 without changing the URL.
- **Browser-harness surprise:** the mandated in-app browser bridge failed before
  connection at its own `browser-client.mjs:33` with `TypeError: Cannot redefine
  property: process`. Bootstrap guidance prohibited an unrelated browser tool or
  source workaround. Review accepted the triangulated hydration test plus live
  workerd delivery and production client-bundle evidence.
- **Native oracle and guardrails:** `vp run verify:next` exits 0 and the native
  App+Pages assertions pass. It retains the pre-existing repeated
  `.animus/system-props.js` per-instance diagnostic while compiling correctly.
  G1–G5, Worker-name uniqueness, and cross-fixture isolation are clean.
- **Decision signal:** DEF-3 resolves positively. The D9 prerelease peer-metadata
  exception is functionally proven. Vinext supplies no DEF-2 multi-environment
  failure signal; row 05 should resolve DEF-2 after the independent React Router
  SSR build.
- **Proposed journal entries:** signal—hybrid App+Pages build and three live
  routes passed; review—initial rejection required hydration interaction proof,
  fallback accepted after bridge failure; surprise—upstream same-hash CSS
  duplicate emission and partial App Router strict-mode behavior are non-blocking.
  Surfaced variables: `vinext-css-duplicate`, `vinext-app-strict-partial`, and
  `browser-bridge-process-shim`.
