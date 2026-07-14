# Increment 05: React Router v8 Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` or `superpowers:executing-plans` to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking. Run no version-control command.

**Goal:** Add a self-contained React Router v8 SSR canary deployed as Worker
`animus-react-router-canary` and resolve whether Animus needs multi-environment
plugin adaptation.

**Architecture:** React Router owns the client/SSR framework environments and a
Worker entry delegates requests to its generated server build. Cloudflare's Vite
plugin assigns the Worker to the `ssr` environment. One unmodified Animus plugin
instance runs between the Cloudflare and React Router plugins; library changes
are permitted only if a production failure reproduces a state-lifecycle defect.

**Tech Stack:** React Router 8.2.0, React 19.2.7, Vite 8.1.4, Cloudflare Vite
plugin 1.44.0, Animus Vite plugin, Wrangler 4.110.0, Vitest/happy-dom.

---

## Scope

- **Registry row**: 05 · mode: inline · review: subagent
- **Resolves**: DEF-2, React Router legs of D3/D5
- **Depends on**: increments 01 and 04 / D9 and D10
- **Footprint**: `e2e/react-router-app/**` except its accepted `package.json`;
  `packages/vite-plugin/src/**` and `packages/vite-plugin/tests/**` only after a
  reproduced DEF-2 failure; this packet
- **Pushes later**: centralized orchestration, assertions, root docs, Netlify
  removal, and CI ownership belong to row 06; remote state belongs to 2.1.
- **Prohibitions**: no dependency edits, React aliases, root Wrangler config,
  remote deployment, Git commands, or speculative library adaptation.

## Context capsule

- Official Cloudflare guidance for React Router v8 uses `ssr: true`, a
  `workers/app.ts` entry, `cloudflare({ viteEnvironment: { name: 'ssr' } })`,
  and `reactRouter()`.
- D9 locks the exact Node/Vite/React/React Router/Cloudflare graph. D10 proves
  Vinext works with one unadapted Animus instance across RSC/client/SSR.
- DEF-2 resolves **no adaptation** only if this independent SSR production build
  also emits complete CSS without state collision, transform drift, or missing
  transforms. If it fails, preserve the exact diagnostic and add a failing
  `packages/vite-plugin/tests/**` reproduction before touching library code.

## File structure

- `app/root.tsx`: document shell and virtual Animus stylesheet ownership.
- `app/routes.ts`: explicit framework route manifest.
- `app/routes/home.tsx`: Worker SSR and package-component evidence.
- `app/routes/client.tsx`: client hydration interaction evidence.
- `app/entry.server.tsx`: Web Streams SSR response for workerd.
- `src/ds.ts`, `src/components.tsx`: fixture-owned Animus system and components.
- `workers/app.ts`: Worker health route and React Router request delegation.
- `vite.config.ts`, `react-router.config.ts`, `wrangler.jsonc`, `tsconfig.json`:
  framework, Worker environment, and type ownership.
- `scripts/config.test.ts`, `scripts/worker.test.ts`,
  `scripts/hydration.test.tsx`, `scripts/assert-build.ts`, `vitest.config.ts`:
  structural, behavioral, hydration, and production-output contracts.

## Task 05.1: Write the failing structural contract

- [x] **Step 1:** Create `e2e/react-router-app/scripts/config.test.ts`.

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

  function jsonc(path: string): unknown {
    return JSON.parse(source(path).replace(/,\s*([}\]])/g, '$1'));
  }

  describe('React Router Worker canary structure', () => {
    it.each([
      'app/root.tsx',
      'app/routes.ts',
      'app/routes/home.tsx',
      'app/routes/client.tsx',
      'app/entry.server.tsx',
      'src/ds.ts',
      'src/components.tsx',
      'workers/app.ts',
      'vite.config.ts',
      'react-router.config.ts',
      'wrangler.jsonc',
      'scripts/worker.test.ts',
      'scripts/hydration.test.tsx',
      'vitest.config.ts',
    ])('owns %s', (path) => source(path));

    it('composes Cloudflare SSR, one Animus plugin, and React Router', () => {
      const config = source('vite.config.ts');
      expect(config.match(/cloudflare\(/g)).toHaveLength(1);
      expect(config.match(/animusExtract\(/g)).toHaveLength(1);
      expect(config.match(/reactRouter\(/g)).toHaveLength(1);
      expect(config).toContain("name: 'ssr'");
    });

    it('owns the exact Worker identity and full-stack output', () => {
      expect(jsonc('wrangler.jsonc')).toMatchObject({
        name: 'animus-react-router-canary',
        main: './workers/app.ts',
        compatibility_flags: ['nodejs_compat'],
        assets: { directory: './build/client' },
      });
      expect(source('react-router.config.ts')).toMatch(/ssr:\s*true/);
    });

    it('delegates the Worker to the generated server build', () => {
      const worker = source('workers/app.ts');
      expect(worker).toContain('createRequestHandler');
      expect(worker).toContain("virtual:react-router/server-build");
      expect(worker).toContain("'/api/health'");
    });

    it('contains no cross-fixture imports', () => {
      for (const path of [
        'app/root.tsx',
        'app/routes.ts',
        'app/routes/home.tsx',
        'app/routes/client.tsx',
        'src/ds.ts',
        'src/components.tsx',
        'workers/app.ts',
      ]) {
        expect(source(path)).not.toMatch(/e2e\/(next|vite|vinext)-app/);
      }
    });
  });
  ```

- [x] **Step 2:** Run RED.

  ```bash
  bunx vp test run e2e/react-router-app/scripts/config.test.ts
  ```

  Expected: absent owned files fail; test syntax and imports load.

## Task 05.2: Create the Animus system and components

- [x] **Step 1:** Create `e2e/react-router-app/src/ds.ts`.

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

  export type ReactRouterTheme = typeof tokens;

  declare module '@animus-ui/system' {
    interface Theme extends ReactRouterTheme {}
  }

  export const { system: ds, createGlobalStyles } = createSystem({ includes: [testDs] })
    .addGroup('space', space)
    .addGroup('layout', { ...layout, ...flex })
    .addGroup('text', typography)
    .addGroup('surface', { ...color, ...border })
    .build();

  export const globalStyles = createGlobalStyles({
    '*, *::before, *::after': { boxSizing: 'border-box' },
    body: { m: 0, bg: 'background', color: 'text', fontFamily: 'system-ui, sans-serif' },
  });
  ```

- [x] **Step 2:** Create `e2e/react-router-app/src/components.tsx`.

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
      variants: { neutral: { color: 'text' }, danger: { color: 'danger' } },
    })
    .asElement('section');
  ```

## Task 05.3: Add React Router SSR, client, and Worker entries

- [x] **Step 1:** Create `e2e/react-router-app/app/root.tsx`.

  ```tsx
  import type { ReactNode } from 'react';
  import { Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router';
  import 'virtual:animus/styles.css';

  export function Layout({ children }: { children: ReactNode }) {
    return (
      <html lang="en">
        <head><meta charSet="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><Meta /><Links /></head>
        <body>{children}<ScrollRestoration /><Scripts /></body>
      </html>
    );
  }

  export default function App() {
    return <Outlet />;
  }
  ```

- [x] **Step 2:** Create `e2e/react-router-app/app/routes.ts`.

  ```ts
  import { index, route, type RouteConfig } from '@react-router/dev/routes';

  export default [
    index('routes/home.tsx'),
    route('client', 'routes/client.tsx'),
  ] satisfies RouteConfig;
  ```

- [x] **Step 3:** Create `e2e/react-router-app/app/routes/home.tsx`.

  ```tsx
  import { Button as PackageButton, Card as PackageCard } from '@animus-ui/test-ds';

  import { Button, Panel, Stack } from '../../src/components';

  export function loader() {
    return { runtime: 'cloudflare-worker-ssr' };
  }

  export default function Home({ loaderData }: { loaderData: { runtime: string } }) {
    return (
      <Stack p={32} gap={24}>
        <h1>React Router v8 SSR canary</h1>
        <p>Runtime: {loaderData.runtime}</p>
        <Stack direction="row" gap={8}>
          <Button intent="primary" size="small">Primary</Button>
          <Button intent="danger" size="large">Danger</Button>
        </Stack>
        <Panel tone="neutral">
          <PackageButton variant="primary" px={24} py={8}>Package component</PackageButton>
          <PackageCard>React Router package extraction</PackageCard>
        </Panel>
      </Stack>
    );
  }
  ```

- [x] **Step 4:** Create `e2e/react-router-app/app/routes/client.tsx`.

  ```tsx
  import { useState } from 'react';

  import { Button, Panel, Stack } from '../../src/components';

  const intents = ['primary', 'danger', 'ghost'] as const;

  export default function ClientRoute() {
    const [index, setIndex] = useState(0);
    const intent = intents[index % intents.length];
    return (
      <Stack p={32} gap={16}>
        <h1>React Router v8 client canary</h1>
        <Button intent={intent} onClick={() => setIndex((value) => value + 1)}>
          Intent: {intent}
        </Button>
        <Panel tone={intent === 'danger' ? 'danger' : 'neutral'}>Hydrated count: {index}</Panel>
      </Stack>
    );
  }
  ```

- [x] **Step 5:** Create `e2e/react-router-app/app/entry.server.tsx`.

  ```tsx
  import { renderToReadableStream } from 'react-dom/server';
  import type { EntryContext } from 'react-router';
  import { ServerRouter } from 'react-router';

  export default async function handleRequest(
    request: Request,
    responseStatusCode: number,
    responseHeaders: Headers,
    routerContext: EntryContext,
  ) {
    const body = await renderToReadableStream(
      <ServerRouter context={routerContext} url={request.url} />,
      { signal: request.signal },
    );
    responseHeaders.set('Content-Type', 'text/html; charset=utf-8');
    return new Response(body, { headers: responseHeaders, status: responseStatusCode });
  }
  ```

- [x] **Step 6:** Create `e2e/react-router-app/workers/app.ts`.

  ```ts
  import { createRequestHandler } from 'react-router';

  const requestHandler = createRequestHandler(
    () => import('virtual:react-router/server-build'),
    import.meta.env.MODE,
  );

  const worker = {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname === '/api/health') {
        return Response.json({
          app: 'animus-react-router-canary',
          runtime: 'cloudflare-worker',
        });
      }
      return requestHandler(request);
    },
  };

  export default worker;
  ```

## Task 05.4: Configure the framework and Worker

- [x] **Step 1:** Create `e2e/react-router-app/vite.config.ts`.

  ```ts
  import { cloudflare } from '@cloudflare/vite-plugin';
  import { reactRouter } from '@react-router/dev/vite';
  import { animusExtract } from '@animus-ui/vite-plugin';
  import { defineConfig } from 'vite';

  export default defineConfig({
    plugins: [
      cloudflare({ viteEnvironment: { name: 'ssr' } }),
      animusExtract({
        system: './src/ds.ts',
        verify: true,
        strict: true,
        engine: process.env.ANIMUS_ENGINE === 'v1' ? 'v1' : 'v2',
      }),
      reactRouter(),
    ],
  });
  ```

- [x] **Step 2:** Create `e2e/react-router-app/react-router.config.ts`.

  ```ts
  import type { Config } from '@react-router/dev/config';

  export default { ssr: true } satisfies Config;
  ```

- [x] **Step 3:** Create `e2e/react-router-app/wrangler.jsonc`.

  ```json
  {
    "$schema": "../../node_modules/wrangler/config-schema.json",
    "name": "animus-react-router-canary",
    "compatibility_date": "2026-07-14",
    "compatibility_flags": ["nodejs_compat"],
    "main": "./workers/app.ts",
    "assets": { "directory": "./build/client" },
    "observability": { "enabled": true }
  }
  ```

- [x] **Step 4:** Create `e2e/react-router-app/tsconfig.json`.

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
      "jsx": "react-jsx",
      "types": ["vite/client"],
      "rootDirs": [".", "./.react-router/types"]
    },
    "include": [".react-router/types/**/*", "app/**/*.ts", "app/**/*.tsx", "src/**/*.ts", "src/**/*.tsx", "workers/**/*.ts", "vite.config.ts", "react-router.config.ts", "styles.d.ts"],
    "exclude": ["node_modules", "build"]
  }
  ```

- [x] **Step 5:** Create `e2e/react-router-app/styles.d.ts`.

  ```ts
  declare module 'virtual:animus/styles.css';
  ```

- [x] **Step 6:** Run the structural contract GREEN and framework typegen/types.

  ```bash
  bunx vp test run e2e/react-router-app/scripts/config.test.ts
  bun run --filter @animus-ui/react-router-app typecheck
  ```

  Expected: structural cases and React Router type generation/typecheck pass.

## Task 05.5: Add behavior, hydration, and artifact assertions

- [x] **Step 1:** Create `e2e/react-router-app/scripts/worker.test.ts`.

  ```ts
  import { describe, expect, it } from 'vitest';
  import worker from '../workers/app';

  describe('React Router Worker', () => {
    it('returns an exact health response before framework delegation', async () => {
      const response = await worker.fetch(new Request('https://example.test/api/health'));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        app: 'animus-react-router-canary',
        runtime: 'cloudflare-worker',
      });
    });
  });
  ```

- [x] **Step 2:** Create `e2e/react-router-app/scripts/hydration.test.tsx`.

  ```tsx
  // @vitest-environment happy-dom
  import { act, createElement } from 'react';
  import { hydrateRoot } from 'react-dom/client';
  import { renderToString } from 'react-dom/server';
  import { afterEach, describe, expect, it } from 'vitest';
  import ClientRoute from '../app/routes/client';

  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  describe('React Router client hydration', () => {
    let root: ReturnType<typeof hydrateRoot> | undefined;
    afterEach(async () => {
      if (root) await act(async () => root?.unmount());
      root = undefined;
      document.body.replaceChildren();
    });

    it('advances state without navigation', async () => {
      history.replaceState(null, '', '/client');
      const initialUrl = window.location.href;
      const container = document.createElement('main');
      container.innerHTML = renderToString(createElement(ClientRoute));
      document.body.append(container);
      await act(async () => { root = hydrateRoot(container, createElement(ClientRoute)); });
      const button = container.querySelector('button');
      const panel = container.querySelector('section');
      expect(button?.textContent).toContain('Intent: primary');
      expect(panel?.textContent).toContain('Hydrated count: 0');
      await act(async () => { button?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
      expect(button?.textContent).toContain('Intent: danger');
      expect(panel?.textContent).toContain('Hydrated count: 1');
      expect(window.location.href).toBe(initialUrl);
    });
  });
  ```

- [x] **Step 3:** Create `e2e/react-router-app/vitest.config.ts`.

  ```ts
  import { defineConfig } from 'vitest/config';

  export default defineConfig({
    root: import.meta.dirname,
    resolve: { dedupe: ['react', 'react-dom'] },
  });
  ```

- [x] **Step 4:** Create `e2e/react-router-app/scripts/assert-build.ts`.

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

  const BUILD = resolve(import.meta.dirname, '..', 'build');

  async function main(): Promise<void> {
    const cssFiles = await findCssFiles(BUILD);
    if (cssFiles.length === 0) throw new AssertionError(`No CSS file found under ${BUILD}`);
    const css = await readAllConcat(cssFiles);
    assertLayerOrder(css, { layers: [layerBlock('anm-base'), layerBlock('anm-variants')] });
    if (!css.includes(':root')) throw new AssertionError('Expected a :root variable block');
    assertNoPlaceholders(css);
    const jsFiles = await findJsFiles(BUILD);
    const js = await readAllConcat(jsFiles);
    assertClassNameFormat(`${css}\n${js}`, { prefix: 'animus-' });
    if (!js.includes('React Router v8 SSR canary')) throw new AssertionError('SSR marker missing');
    if (!js.includes('React Router v8 client canary')) throw new AssertionError('Client marker missing');
    for (const file of jsFiles) assertNoEmotionImports(await readFile(file, 'utf8'));
    console.log(`[react-router-app:assert] ${cssFiles.length} CSS, ${jsFiles.length} JS — all assertions passed`);
  }

  main().catch((error) => {
    console.error('[react-router-app:assert] FAIL:', error);
    process.exit(1);
  });
  ```

- [x] **Step 5:** Run focused behavior and hydration tests.

  ```bash
  cd e2e/react-router-app
  bunx vp test run --config vitest.config.ts scripts/config.test.ts scripts/worker.test.ts scripts/hydration.test.tsx
  ```

  Expected: health, structure, and hydration interaction pass.

## Task 05.6: Build and decide DEF-2

- [x] **Step 1:** Run the production build without library adaptation.

  ```bash
  bun run --filter @animus-ui/react-router-app build
  ```

  Expected: client and Worker SSR environments finish with complete Animus CSS.
  On state collision, transform drift, or missing styles, stop; add a failing
  Vite-plugin reproduction before changing library code.

- [x] **Step 2:** Run artifact and deployment proofs.

  ```bash
  bun e2e/react-router-app/scripts/assert-build.ts
  bun run --filter @animus-ui/react-router-app cf:dry-run
  ```

  Expected: CSS/class/layer/SSR/client assertions and redirected deployment dry
  run exit 0.

- [x] **Step 3:** Start local workerd and smoke `/api/health`, `/`, and `/client`.

  ```bash
  cd e2e/react-router-app
  bunx wrangler dev --port 8795 --local
  ```

  Expected: health returns exact JSON; both framework routes return 200 HTML with
  their marker and an Animus class; server shuts down cleanly.

- [x] **Step 4:** Re-run Vinext to complete the cross-framework decision.

  ```bash
  bun run --filter @animus-ui/vinext-app build
  bun e2e/vinext-app/scripts/assert-build.ts
  ```

  Expected: Vinext remains green after React Router work.

## Guardrail gate

- [x] G1 native Next plugin retained.
- [x] G2 repository-root `wrangler.jsonc` absent.
- [x] G3 all app Worker names unique.
- [x] G4 no `packages/*` import from `e2e/*`.
- [x] G5 no checked-in Cloudflare token value.
- [x] No cross-fixture import from the React Router app.

Use the verbatim commands in `design.md`; expected output matches prior rows.

## Output contract

- [x] Tick only completed packet checkboxes.
- [x] Record RED/GREEN, typegen/typecheck, behavior/hydration, build, assert,
  dry-run, workerd, and Vinext-regression evidence.
- [x] Resolve DEF-2 explicitly: no adaptation, or adaptation with the exact
  failing reproduction and library tests.
- [x] Proposed journal signal/review/surprise entries and surfaced variables.
- [x] Do not edit shared OpenSpec artifacts before review acceptance.

## Implementation record

- **Structural TDD:** RED failed all 18 cases only on absent owned files. GREEN
  passes 18/18 after the fixture is present.
- **Framework types:** the first typecheck exposed that `.react-router/types/**/*`
  was missing from the fixture's `include`; React Router had correctly generated
  `+server-build.d.ts`. Adding the generated-type path resolves the virtual
  server-build module, and typegen plus `tsgo --noEmit` pass.
- **Behavior and hydration:** fixture-root tests pass 20/20 across structure, the
  exact Worker health response, and React 19 SSR-to-`hydrateRoot` interaction.
  The client route advances primary→danger and count 0→1 without navigation.
- **Production build:** the unmodified Animus plugin builds 97 client and 92 SSR
  modules with no state-collision, transform-drift, missing-style, or strict
  extraction diagnostic. Client and SSR each emit the same 8.56 kB Animus CSS.
  No file under `packages/vite-plugin/**` changed.
- **Artifacts and deployability:** post-build assertions pass across 2 CSS and 12
  JavaScript files. Wrangler redirects to `build/server/wrangler.json`, packages
  three server modules plus 11 client assets, and exits 0 in dry-run mode.
- **Runtime:** local workerd returns the exact `/api/health` JSON and 200 HTML for
  `/` and `/client`. SSR/runtime and client markers plus Animus classes are
  present; the server shuts down cleanly.
- **Cross-framework regression:** the Vinext five-environment/hybrid build still
  exits 0 and its 4-CSS/80-JS assertions pass with only its accepted same-hash
  CSS duplicate warning.
- **Decision:** DEF-2 resolves to **no Animus multi-environment adaptation**. Two
  independent full-stack framework builds preserve complete output with the
  existing per-instance plugin lifecycle.
- **Guardrails:** G1–G5, Worker-name uniqueness, and cross-fixture isolation are
  clean.
- **Proposed journal entries:** signal—React Router client/SSR and workerd proof
  passed without library change; review—record the reviewer verdict; surprise—
  generated React Router types must be explicitly included. Surfaced variable:
  `react-router-generated-types-include`.
