#!/usr/bin/env bash
set -euo pipefail

# verify:packed — pack all five publishables once or consume a supplied
# immutable tarball directory, lint those exact files, install into an isolated
# non-workspace consumer, prove ESM/CJS loading, published declarations (stable
# TypeScript), both extractor engines, Vite + Next production builds, then run
# repo-side positional assertions.
# Fail-loud contract per root CLAUDE.md: name the missing artifact and the
# repairing command; never rebuild silently.

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
source "$ROOT/scripts/verify/_preconditions.sh"

PKGS=(properties system extract vite-plugin next-plugin)
require_bun_install
RESOLUTION=$(bun scripts/verify/packed-graph.ts resolve "$@")
MODE=$(printf '%s\n' "$RESOLUTION" | awk -F '\t' '$1 == "mode" { print $2 }')

require_fresh_package_dist _assertions
if [ "$MODE" = local ]; then
  require_fresh_napi_v2
  for p in "${PKGS[@]}"; do require_fresh_package_dist "$p"; done
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: npm missing. Run: install Node per .tool-versions" >&2
  exit 1
fi
if [ ! -x node_modules/.bin/publint ] || [ ! -x node_modules/.bin/attw ]; then
  echo "ERROR: publint/attw missing. Run: bun install" >&2
  exit 1
fi

STAGING="$ROOT/e2e/packed-app/.staging"
rm -rf "$STAGING"
mkdir -p "$STAGING/tarballs"

# ── 1. Resolve one tarball set + workspace-specifier guard ───────────
if [ "$MODE" = local ]; then
  for p in "${PKGS[@]}"; do
    (cd "packages/$p" && bun pm pack --destination "$STAGING/tarballs" >/dev/null)
  done
  # Normalize to the version-stable names the template's file: paths expect.
  for p in "${PKGS[@]}"; do
    src=$(find "$STAGING/tarballs" -maxdepth 1 -type f -name "animus-ui-$p-[0-9]*.tgz" -print | head -n1)
    if [ -z "$src" ]; then
      echo "ERROR: tarball for @animus-ui/$p not produced. Run: cd packages/$p && bun pm pack" >&2
      exit 1
    fi
    mv "$src" "$STAGING/tarballs/animus-ui-$p.tgz"
  done
  echo "[verify:packed] packed ${#PKGS[@]} tarballs once"
else
  for p in "${PKGS[@]}"; do
    src=$(printf '%s\n' "$RESOLUTION" | awk -F '\t' -v package="@animus-ui/$p" '$1 == "tarball" && $2 == package { print $3 }')
    cp "$src" "$STAGING/tarballs/animus-ui-$p.tgz"
  done
  echo "[verify:packed] using supplied immutable tarballs"
fi

for f in "$STAGING"/tarballs/*.tgz; do
  if tar -xzOf "$f" package/package.json | grep -q '"workspace:'; then
    echo "ERROR: $(basename "$f") retains a workspace: specifier." >&2
    exit 1
  fi
done
bun scripts/verify/packed-graph.ts manifests "$STAGING"/tarballs/*.tgz
echo "[verify:packed] embedded internal dependency graph ok"

# ── 2. Tarball lint: export-map + type-resolution ──────────────────
for p in "${PKGS[@]}"; do
  echo "[verify:packed] publint @animus-ui/$p"
  bunx publint --strict "$STAGING/tarballs/animus-ui-$p.tgz"
done
# Supported type-resolution matrix (design D7, release-truth-v1, revised):
# node16 profile for CJS/dual surfaces; esm-only for the ESM-only packages
# (properties, system — require() of these is explicitly unsupported; their
# node16-ESM declaration gap is DEF-5). node10 is out of contract.
# NOTE: always invoke attw with repo-root cwd — bunx from elsewhere can
# fetch the unrelated "attw" placeholder package (dependency confusion).
for p in "${PKGS[@]}"; do
  case "$p" in
    properties|system)
      # Bounded DEF-5 gate (guardrail G6, replaces the broad rule-wide attw
      # allowlist that ignored every internal resolution error). properties/system
      # source uses extensionless relative imports under bundler resolution;
      # stable-TS (7.0.2) emits them verbatim, so their declarations fail
      # node16-ESM resolution. attw runs with NO ignored rule and its JSON is
      # checked against the exact captured DEF-5 diagnostic set: a new resolution
      # error, an obsolete one, or any other esm-only-visible problem fails
      # closed. See scripts/verify/attw-def5.ts.
      echo "[verify:packed] attw @animus-ui/$p (--profile esm-only, bounded DEF-5 gate)"
      # attw JSON exceeds the 64KiB command-substitution/pipe cap for system, so
      # stage it to a file (no truncation) and feed it to the validator on stdin.
      # attw exits non-zero on findings (|| true); the validator owns the verdict.
      attw_out="$STAGING/attw-$p.json"
      bunx attw "$STAGING/tarballs/animus-ui-$p.tgz" \
        --profile esm-only -f json >"$attw_out" 2>/dev/null || true
      bun scripts/verify/attw-def5.ts check "@animus-ui/$p" <"$attw_out"
      ;;
    *)
      echo "[verify:packed] attw @animus-ui/$p (--profile node16)"
      bunx attw --profile node16 "$STAGING/tarballs/animus-ui-$p.tgz"
      ;;
  esac
done

# ── 3. Isolated install from the committed template ────────────────
cp e2e/packed-app/package.json e2e/packed-app/tsconfig.json \
   e2e/packed-app/vite.config.ts e2e/packed-app/next.config.ts \
   e2e/packed-app/index.html "$STAGING/"
cp -R e2e/packed-app/src e2e/packed-app/app "$STAGING/"
# Optional deps stay installed: third-party natives (lightningcss) ship
# their binaries as optionalDependencies, and extract's REGISTRY platform
# packages are part of its published contract (the v1 loader prefers the
# tarball-local binary; the fault-injection proof below covers absence).
(cd "$STAGING" && npm install --no-audit --no-fund --loglevel=error)
echo "[verify:packed] npm install complete"

# ── 4. Recursive workspace-leakage + version assertions ─────────────
bun scripts/verify/packed-graph.ts installed "$STAGING" "$STAGING"/tarballs/*.tgz
echo "[verify:packed] recursive installed package graph ok"

# ── 5. Load proof: ESM + CJS + both engines ─────────────────────────
(cd "$STAGING" && node --input-type=module -e "
  for (const p of ['@animus-ui/properties','@animus-ui/system','@animus-ui/vite-plugin','@animus-ui/next-plugin','@animus-ui/extract']) {
    const m = await import(p);
    if (!m || Object.keys(m).length === 0) throw new Error('empty ESM module: ' + p);
  }
  console.log('[verify:packed] ESM load ok');
")
(cd "$STAGING" && node -e "
  // Root entry IS the v2 surface since retire-extract-v1 (the transitional
  // engine-v2 alias was removed once no consumers remained).
  const root = require('@animus-ui/extract');
  if (typeof root.ExtractEngine !== 'function') throw new Error('root entry: ExtractEngine missing from packed install');
  console.log('[verify:packed] CJS root engine ok');
")

# ── 6. Published-declaration type-check (stable TypeScript) ─────────
# --skipLibCheck false pins the strict lib check here; the template's
# tsconfig sets skipLibCheck:true so Next's own build-time check doesn't
# lib-check Next's internal template declarations.
(cd "$STAGING" && ./node_modules/.bin/tsc -p tsconfig.json --noEmit --skipLibCheck false)
echo "[verify:packed] stable-TS declaration check ok"

# ── 7. Consumer builds ──────────────────────────────────────────────
(cd "$STAGING" && npm run build:vite)
(cd "$STAGING" && npm run build:next)

# ── 8. Receipt (engine + package-form dimensions) ───────────────────
# Engine facts are STRUCTURAL GUARDS over the staged artifacts, never inferred
# from plugin/config source (guardrail G3). retire-extract-v1: v2 is the only
# engine, so the consumer configs must contain NO engine selection and the
# installed plugin code must carry the retirement guard; any 'v1' reference in
# the staged configs is a loud regression.
mkdir -p "$STAGING/receipts"
node -e "
  const fs = require('fs');
  const path = require('path');
  const staging = process.argv[1];
  const vite = require(staging + '/node_modules/vite/package.json').version;
  const next = require(staging + '/node_modules/next/package.json').version;

  function assertNoEngineSelection(file) {
    const src = fs.readFileSync(path.join(staging, file), 'utf8');
    if (/engine\s*:\s*['\"]v[12]['\"]|ANIMUS_ENGINE/.test(src)) {
      throw new Error(file + ' selects an extraction engine — v1 was retired (retire-extract-v1) and v2 needs no selection');
    }
  }
  function assertRetirementGuard(globDir) {
    // The guard call is imported from the externalized extract pipeline, so
    // runtime bundles carry the identifier; inlined bundles would carry the
    // message (which names the change). Either marker proves the guard.
    const dir = path.join(staging, globDir);
    for (const f of fs.readdirSync(dir)) {
      if (!/\.(cjs|mjs|js)$/.test(f)) continue;
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      if (src.includes('assertNoRetiredEngineSelection') || src.includes('retire-extract-v1')) return;
    }
    throw new Error('installed plugin in ' + globDir + ' lacks the v1 retirement guard — update the receipt probe');
  }

  assertNoEngineSelection('vite.config.ts');
  assertNoEngineSelection('next.config.ts');
  assertRetirementGuard('node_modules/@animus-ui/vite-plugin/dist');
  assertRetirementGuard('node_modules/@animus-ui/next-plugin/dist');

  const receipts = [
    { lane: 'verify:packed:vite', host: 'vite', hostVersion: vite, mode: 'production', engineLoaded: 'v2', engineDefault: 'v2', engineOverride: false, packageForm: 'packed' },
    { lane: 'verify:packed:next', host: 'next', hostVersion: next, mode: 'production', engineLoaded: 'v2', engineDefault: 'v2', engineOverride: false, packageForm: 'packed' }
  ];
  fs.writeFileSync(staging + '/receipts/packed.json', JSON.stringify(receipts, null, 2) + '\n');
  console.log('[verify:packed] receipts written:', receipts.map(r => r.lane + '=' + r.engineLoaded).join(', '));
" "$STAGING"

# ── 9. Outside-repository Svelte + resolver-only runtime proof ──────
# A workspace build can resolve React from the repository root even when the
# consumer forgot to declare it. Stage two independent consumers under the OS
# temp root instead, where no ancestor workspace node_modules can mask the
# published dependency graph: one resolver-only production consumer and one
# complete Svelte authoring/build consumer.
RESOLVER_STAGING=$(mktemp -d "${TMPDIR:-/tmp}/animus-svelte-resolver-only.XXXXXX")
SVELTE_STAGING=$(mktemp -d "${TMPDIR:-/tmp}/animus-svelte-packed.XXXXXX")
for OUTSIDE_STAGING in "$RESOLVER_STAGING" "$SVELTE_STAGING"; do
case "$OUTSIDE_STAGING" in
  "$ROOT"|"$ROOT"/*)
    echo "ERROR: Svelte packed staging must be outside the repository: $OUTSIDE_STAGING" >&2
    exit 1
    ;;
esac
done
cleanup_svelte_staging() {
  rm -rf "$RESOLVER_STAGING"
  rm -rf "$SVELTE_STAGING"
}
trap cleanup_svelte_staging EXIT

mkdir -p "$RESOLVER_STAGING/tarballs"
cp "$STAGING"/tarballs/animus-ui-{properties,system}.tgz \
  "$RESOLVER_STAGING/tarballs/"
cp e2e/svelte-app/resolver-only.package.json "$RESOLVER_STAGING/package.json"

mkdir -p "$SVELTE_STAGING/tarballs"
cp "$STAGING"/tarballs/animus-ui-{properties,system,extract,vite-plugin}.tgz \
  "$SVELTE_STAGING/tarballs/"
cp e2e/svelte-app/index.html e2e/svelte-app/vite.config.ts \
  "$SVELTE_STAGING/"
cp -R e2e/svelte-app/src "$SVELTE_STAGING/"
cp e2e/svelte-app/packed.package.json "$SVELTE_STAGING/package.json"
cp e2e/svelte-app/packed.tsconfig.json "$SVELTE_STAGING/tsconfig.json"

# Phase 1: resolver-only production graph. Its committed manifest has no React
# or development tooling, so a plain install proves the published resolver
# subpath is independently loadable.
(cd "$RESOLVER_STAGING" && npm install --no-audit --no-fund --loglevel=error)

node --input-type=module - "$RESOLVER_STAGING" <<'NODE'
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.argv[2];
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
for (const field of [
  'dependencies',
  'peerDependencies',
  'optionalDependencies',
]) {
  if (manifest[field]?.react != null) {
    throw new Error(`packed Svelte manifest declares runtime React in ${field}`);
  }
}

for (let ancestor = root; ; ancestor = dirname(ancestor)) {
  if (existsSync(join(ancestor, 'node_modules', 'react'))) {
    throw new Error(`React is present beneath ancestor ${ancestor}`);
  }
  const parent = dirname(ancestor);
  if (parent === ancestor) break;
}

const requireFromConsumer = createRequire(join(root, 'package.json'));
try {
  requireFromConsumer.resolve('react');
  throw new Error('React unexpectedly resolves from packed Svelte consumer');
} catch (error) {
  if (error?.code !== 'MODULE_NOT_FOUND') throw error;
}

const resolverEntry = requireFromConsumer.resolve(
  '@animus-ui/system/class-resolver'
);
const resolverRuntime = await import(
  pathToFileURL(resolverEntry).href
);
if (typeof resolverRuntime.createClassResolver !== 'function') {
  throw new Error('packed class-resolver entry has no createClassResolver');
}

console.log(
  '[verify:packed] resolver-only production install has no React and loads class-resolver'
);
NODE

# Phase 2: independent authoring graph with React ABSENT (openspec:
# packed-consumer-verification, "React-absent Svelte authoring proof"). The
# resolver definition module binds the configured system through a type-only
# import + declared chain root, so the application module graph never
# evaluates the React-reaching builder barrel; the extraction loader stubs
# React and evaluates the system independently. Exact @types/react stays for
# the strict declaration closure (DEF-2 owns removing it).
(cd "$SVELTE_STAGING" && npm install --no-audit --no-fund --loglevel=error)

(cd "$SVELTE_STAGING" && node --input-type=module <<'NODE'
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const root = process.cwd();
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const requireFromConsumer = createRequire(join(root, 'package.json'));
for (const field of [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
]) {
  if (manifest[field]?.react != null) {
    throw new Error(`packed Svelte authoring manifest declares React in ${field}`);
  }
}
if (manifest.devDependencies?.['@types/react'] !== '18.3.28') {
  throw new Error('packed Svelte authoring graph must pin @types/react@18.3.28 in devDependencies');
}

for (let ancestor = root; ; ancestor = dirname(ancestor)) {
  if (existsSync(join(ancestor, 'node_modules', 'react'))) {
    throw new Error(`React is present beneath ancestor ${ancestor}`);
  }
  const parent = dirname(ancestor);
  if (parent === ancestor) break;
}

try {
  requireFromConsumer.resolve('react');
  throw new Error('React unexpectedly resolves from packed Svelte authoring consumer');
} catch (error) {
  if (error?.code !== 'MODULE_NOT_FOUND') throw error;
}
requireFromConsumer.resolve('@types/react/package.json');

console.log(
  '[verify:packed] Svelte authoring install has React undeclared, absent, and unresolvable with exact React types available'
);
NODE
)

(cd "$SVELTE_STAGING" && ./node_modules/.bin/tsc -p tsconfig.json)
echo "[verify:packed] outside-repo Svelte authoring TypeScript check ok (React absent)"

# Development proof: a middleware-mode dev server must serve the resolver
# definition module as its extracted replacement — no configured-system
# import survives TypeScript erasure, and no React reaches the transform.
(cd "$SVELTE_STAGING" && node --input-type=module <<'NODE'
import { createServer } from 'vite';

const server = await createServer({
  configFile: './vite.config.ts',
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});
try {
  const result = await server.transformRequest('/src/definitions.ts');
  const code = result?.code;
  if (!code) throw new Error('development transform returned no code');
  if (!code.includes('createClassResolver')) {
    throw new Error('served definitions module lacks the class-resolver replacement');
  }
  const forbidden = [
    // Vite's import analysis rewrites relative specifiers in served code
    // (./ds -> /src/ds.ts?v=...), so match ANY specifier form that reaches
    // the configured system module, not the raw source text.
    /["'][^"']*\/ds(?:\.[a-z]+)?(?:\?[^"']*)?["']/,
    // React import forms are defense-in-depth only: React is proven
    // unresolvable above, so a surviving import would already have made
    // transformRequest itself throw.
    /\bfrom\s*["']react(?:\/[^"']*)?["']/,
    /\brequire\(\s*["']react(?:\/[^"']*)?["']\s*\)/,
    /react\/jsx-runtime/,
    /\bcreateSystem\b/,
    /\bcreateTheme\b/,
  ];
  for (const pattern of forbidden) {
    if (pattern.test(code)) {
      throw new Error(`served definitions module retained ${pattern}`);
    }
  }
  console.log(
    '[verify:packed] middleware-mode dev transform serves the extraction-only replacement React-free'
  );
} finally {
  await server.close();
}
NODE
)

(cd "$SVELTE_STAGING" && npm run build)

# The proof above intentionally checks dependency resolution before the build;
# artifact and SSR assertions run after compilation without changing the
# installed graph.
node --input-type=module - "$SVELTE_STAGING" <<'NODE'
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.argv[2];
const assets = join(root, 'dist', 'client', 'assets');
const client = readdirSync(assets)
  .filter((name) => name.endsWith('.js'))
  .map((name) => readFileSync(join(assets, name), 'utf8'))
  .join('\n');
const ssrPath = join(root, 'dist', 'server', 'ssr.js');
const server = readFileSync(ssrPath, 'utf8');
const forbidden = [
  /\bfrom\s*["']react(?:\/[^"']*)?["']/,
  /\brequire\(\s*["']react(?:\/[^"']*)?["']\s*\)/,
  /react\/jsx-runtime/,
  /react\.production(?:\.min)?\.js/,
  /react\.development\.js/,
  /Symbol\.for\(["']react\./,
  /\b(?:forwardRef|cloneElement|isValidElement)\b/,
  /\bcreateSystem\b/,
  /\bcreateTheme\b/,
];
for (const [label, source] of [
  ['client', client],
  ['SSR', server],
]) {
  for (const pattern of forbidden) {
    if (pattern.test(source)) {
      throw new Error(`packed Svelte ${label} retained ${pattern}`);
    }
  }
}
const { renderedHtml } = await import(pathToFileURL(ssrPath).href);
const dynamicTag = renderedHtml.match(
  /<section\b[^>]*data-animus-probe=["']dynamic["'][^>]*>/
)?.[0];
if (
  !dynamicTag ||
  !/\banimus-dyn-[a-f0-9]+-gap\b/.test(dynamicTag) ||
  !/--animus-gap:\s*13px/.test(dynamicTag)
) {
  throw new Error(
    `packed Svelte SSR output lacks the dynamic class/style probe: ${dynamicTag}`
  );
}
console.log(
  '[verify:packed] outside-repo Svelte client + SSR are React-free and builder-free'
);
NODE

cleanup_svelte_staging
trap - EXIT

# ── 10. Repo-side positional assertions ─────────────────────────────
exec bun run e2e/packed-app/scripts/assert-build.ts
