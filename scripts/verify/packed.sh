#!/usr/bin/env bash
set -euo pipefail

# verify:packed — pack all five publishables, lint the tarballs, install
# into an isolated non-workspace consumer, prove ESM/CJS loading, published
# declarations (stable TypeScript), both extractor engines, Vite + Next
# production builds, then run repo-side positional assertions.
# Fail-loud contract per root CLAUDE.md: name the missing artifact and the
# repairing command; never rebuild silently.

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
source "$ROOT/scripts/verify/_preconditions.sh"

PKGS=(properties system extract vite-plugin next-plugin)

require_bun_install
require_fresh_napi
require_fresh_napi_v2
for p in "${PKGS[@]}"; do require_fresh_package_dist "$p"; done
require_fresh_package_dist _assertions
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

# ── 1. Pack + workspace-specifier guard ─────────────────────────────
for p in "${PKGS[@]}"; do
  (cd "packages/$p" && bun pm pack --destination "$STAGING/tarballs" >/dev/null)
done
for f in "$STAGING"/tarballs/*.tgz; do
  if tar -xzOf "$f" package/package.json | grep -q '"workspace:'; then
    echo "ERROR: $(basename "$f") retains a workspace: specifier. Inspect bun pm pack output for the package." >&2
    exit 1
  fi
done
# Normalize to the version-stable names the template's file: paths expect
for p in "${PKGS[@]}"; do
  src=$(ls "$STAGING"/tarballs/animus-ui-"$p"-*.tgz 2>/dev/null | head -n1 || true)
  if [ -z "$src" ]; then
    echo "ERROR: tarball for @animus-ui/$p not produced. Run: cd packages/$p && bun pm pack" >&2
    exit 1
  fi
  mv "$src" "$STAGING/tarballs/animus-ui-$p.tgz"
done
echo "[verify:packed] packed ${#PKGS[@]} tarballs"

# ── 2. Tarball lint: export-map + type-resolution ──────────────────
for p in "${PKGS[@]}"; do
  echo "[verify:packed] publint @animus-ui/$p"
  bunx publint --strict "packages/$p" --pack bun
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
      # DEF-5 allowlist: extensionless specifiers in the tsgo bundler-mode
      # declaration emit fail node16-ESM resolution. Bundler mode must stay
      # green; remove --ignore-rules when DEF-5's toolchain fix lands.
      echo "[verify:packed] attw @animus-ui/$p (--profile esm-only, DEF-5 allowlist)"
      bunx attw "$STAGING/tarballs/animus-ui-$p.tgz" \
        --profile esm-only --ignore-rules internal-resolution-error
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

# ── 4. Workspace-leakage + version assertions ──────────────────────
leaks=$(find "$STAGING/node_modules/@animus-ui" -maxdepth 1 -type l 2>/dev/null || true)
if [ -n "$leaks" ]; then
  echo "ERROR: packed consumer resolved from workspace via symlink: $leaks" >&2
  exit 1
fi
# Defense-in-depth: every installed @animus-ui/* entry must be either one
# of the five packages packed by this lane or an optional platform-binary
# dependency DECLARED by the packed extract manifest — anything else is an
# unexplained registry leak.
declared_optionals=$(tar -xzOf "$STAGING/tarballs/animus-ui-extract.tgz" package/package.json \
  | node -e "let c='';process.stdin.on('data',d=>c+=d).on('end',()=>console.log(Object.keys(JSON.parse(c).optionalDependencies??{}).map(n=>n.replace('@animus-ui/','')).join(' ')))")
for entry in "$STAGING"/node_modules/@animus-ui/*/; do
  name=$(basename "$entry")
  case " ${PKGS[*]} $declared_optionals " in
    *" $name "*) ;;
    *)
      echo "ERROR: unexpected @animus-ui/$name in packed install (registry leak — neither packed by this lane nor a declared optional platform package)." >&2
      exit 1
      ;;
  esac
done
for p in "${PKGS[@]}"; do
  packed_v=$(tar -xzOf "$STAGING/tarballs/animus-ui-$p.tgz" package/package.json | node -e "let c='';process.stdin.on('data',d=>c+=d).on('end',()=>console.log(JSON.parse(c).version))")
  installed_v=$(node -p "require('$STAGING/node_modules/@animus-ui/$p/package.json').version")
  if [ "$packed_v" != "$installed_v" ]; then
    echo "ERROR: @animus-ui/$p installed $installed_v but tarball is $packed_v (registry substitution?)." >&2
    exit 1
  fi
done
echo "[verify:packed] isolation + version assertions ok"

# ── 5. Load proof: ESM + CJS + both engines ─────────────────────────
(cd "$STAGING" && node --input-type=module -e "
  for (const p of ['@animus-ui/properties','@animus-ui/system','@animus-ui/vite-plugin','@animus-ui/next-plugin','@animus-ui/extract']) {
    const m = await import(p);
    if (!m || Object.keys(m).length === 0) throw new Error('empty ESM module: ' + p);
  }
  console.log('[verify:packed] ESM load ok');
")
(cd "$STAGING" && node -e "
  const v1 = require('@animus-ui/extract');
  if (typeof v1.analyzeProject !== 'function') throw new Error('v1 engine: analyzeProject missing from packed install');
  const v2 = require('@animus-ui/extract/engine-v2');
  if (typeof v2.ExtractEngine !== 'function') throw new Error('v2 engine: ExtractEngine missing from packed install');
  console.log('[verify:packed] CJS + both engines ok');
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
# Engine facts are MEASURED from the staged artifacts, not asserted: the
# override flag comes from the consumer configs actually built; the default
# comes from the installed (packed) plugin code. A default flip in a future
# release changes the receipt without touching this script.
mkdir -p "$STAGING/receipts"
node -e "
  const fs = require('fs');
  const path = require('path');
  const staging = process.argv[1];
  const vite = require(staging + '/node_modules/vite/package.json').version;
  const next = require(staging + '/node_modules/next/package.json').version;

  function configOverride(file) {
    const src = fs.readFileSync(path.join(staging, file), 'utf8');
    const m = src.match(/engine\s*:\s*['\"](v[12])['\"]/);
    return m ? m[1] : null;
  }
  function pluginDefault(globDir, pattern) {
    const dir = path.join(staging, globDir);
    for (const f of fs.readdirSync(dir)) {
      if (!/\.(cjs|mjs|js)$/.test(f)) continue;
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      const m = src.match(pattern);
      if (m) return m[1];
    }
    throw new Error('cannot determine default engine from installed plugin in ' + globDir + ' — update the receipt probe');
  }

  const viteOverride = configOverride('vite.config.ts');
  const nextOverride = configOverride('next.config.ts');
  const viteDefault = pluginDefault('node_modules/@animus-ui/vite-plugin/dist', /engine\s*\?\?\s*['\"](v[12])['\"]/);
  const nextDefault = pluginDefault('node_modules/@animus-ui/next-plugin/dist', /\|\|\s*['\"](v[12])['\"]/);

  const receipts = [
    { lane: 'verify:packed:vite', host: 'vite', hostVersion: vite, mode: 'production', engineLoaded: viteOverride ?? viteDefault, engineDefault: viteDefault, engineOverride: viteOverride !== null, packageForm: 'packed' },
    { lane: 'verify:packed:next', host: 'next', hostVersion: next, mode: 'production', engineLoaded: nextOverride ?? nextDefault, engineDefault: nextDefault, engineOverride: nextOverride !== null, packageForm: 'packed' }
  ];
  fs.writeFileSync(staging + '/receipts/packed.json', JSON.stringify(receipts, null, 2) + '\n');
  console.log('[verify:packed] receipts written:', receipts.map(r => r.lane + '=' + r.engineLoaded).join(', '));
" "$STAGING"

# ── 9. Repo-side positional assertions ──────────────────────────────
exec bun run e2e/packed-app/scripts/assert-build.ts
