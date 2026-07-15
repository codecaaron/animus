# Increment 02: packed-lane

## Scope

- **Registry row**: 02 · mode: inline · review: subagent
- **Resolves**: D2; D4 (the packed-lane receipt half; existing-lane receipts
  are increment 06)
- **Authors**: — (envelope: all §packed-consumer-verification requirements
  and §verification-tier-policy/Packed Consumer Tier already authored)
- **Depends on (ordering — deps:)**: none
- **Inputs from (information — inputs:)**: none
- **Footprint**: `e2e/packed-app/**`, `vite.config.ts`,
  `scripts/verify/**`, `package.json` (root, devDeps only), `.gitignore`
- **Pushes to a later increment**: composite membership rows in CLAUDE.md
  (increment 05); DEF-1 (v2 distribution form) receives its resolving
  receipt from this increment but is decided elsewhere

> Resolving signal: envelope-licensed (implements decided-now D2/D4).

## Context Capsule

- **Objective**: A new atomic tier `vp run verify:packed` packs the five
  publishables, lints the tarballs, installs them into an isolated
  non-workspace consumer at `e2e/packed-app/.staging/`, proves ESM/CJS
  loading, published-declaration type-check, both engine entrypoints, Vite
  and Next production builds, and runs repo-side positional assertions
  against both outputs. It emits a JSON receipt recording engine and
  package-form dimensions.
- **In-scope guardrails** (from design.md Register):
  - G2: packed consumer SHALL NOT resolve `@animus-ui/*` from the workspace
    — check: `find e2e/packed-app/.staging/node_modules/@animus-ui -maxdepth 1 -type l 2>/dev/null`
    — expected empty — STOP
  - G4: `verify:packed` SHALL NOT silently rebuild upstream — check:
    `mv packages/system/dist packages/system/dist.bak && (vp run verify:packed; echo "exit=$?") ; mv packages/system/dist.bak packages/system/dist`
    — expected: non-zero exit with `ERROR: ... Run: ...`, no rebuild — STOP
- **Requirements to draft**: none — envelope covers.
- **Existing spec context**: change-level
  `specs/packed-consumer-verification/spec.md` (all six requirements) and
  `specs/verification-tier-policy/spec.md` → "Packed Consumer Tier". These
  are the acceptance criteria; read them before implementing.
- **Relevant resolved decisions (constraints)**:
  - D2: pack with `bun pm pack`; lint with publint + attw; install with
    **npm** into a copy of a committed template; `file:` tarball deps AND an
    `overrides` block keep transitive `@animus-ui/*` resolution local.
  - D4: receipt fields — lane, host, hostVersion, mode, engineLoaded,
    engineDefault, engineOverride, packageForm.
- **Repo facts a cold agent needs**:
  - `scripts/verify/postpack-smoke.sh` is the existing single-package
    precedent: packs extract, extracts the tarball, requires `./index.js`
    and `./index-v2.js`. Read it first; `verify:packed` generalizes it.
    Leave it untouched — its `--expect-full-matrix` release mode stays.
  - Precondition helpers: `source scripts/verify/_preconditions.sh`, then
    `require_bun_install`, `require_fresh_napi`, `require_fresh_napi_v2`,
    `require_fresh_package_dist <pkg>`. Follow the `ERROR: X missing. Run: Y`
    shape for any new checks.
  - Tier registration pattern in `vite.config.ts` `run.tasks` (locate via
    `rg -n "'verify:parity'" vite.config.ts`):
    `{ command: 'bash scripts/verify/<name>.sh', cache: false }`.
  - Assert-script pattern: `scripts/verify/assert-vite.sh` ends with
    `exec bun run e2e/vite-app/scripts/assert-build.ts` — assertions run
    REPO-SIDE (workspace context) because `@animus-ui/assertions` is a
    private workspace package, NOT one of the five publishables. The packed
    consumer therefore contains no assertion imports.
  - `@animus-ui/test-ds` is also workspace-private: the packed consumer
    CANNOT copy `e2e/vite-app/src` wholesale (it imports test-ds). The
    template gets its own minimal src importing only published packages.
  - Fixture evidence pins: Vite `^8.1.4`, Next `^15.5.20`, React `^18.2.0`
    (mirror `e2e/vite-app/package.json` / `e2e/next-app/package.json`).
  - Engine entrypoints: `@animus-ui/extract` (v1, expects `analyzeProject`
    function) and `@animus-ui/extract/engine-v2` (v2, expects
    `ExtractEngine` constructor) — see the `exports` map in
    `packages/extract/package.json`. Both plugins default to `'v2'`.
  - `bun pm pack` rewrites `workspace:*` to concrete versions; guard it
    anyway (a regression here is exactly what this lane exists to catch).
- **In-scope North Star criteria**: NS1 (package form is part of the
  contract), NS4 (single-runner distribution proof), NS5 (packed lane
  proves loading, parity proves semantics).
- **Prohibitions**: no version-control commands; no writes outside the
  declared footprint plus this file; never write to design.md, tasks.md,
  journal.md, or specs/; do not modify `postpack-smoke.sh` or any existing
  tier.

## Plan

## Task 02.1: Root devDeps and hygiene plumbing

- [x] **Step 1:** Add tarball linters as root devDeps.

Run: `bun add -d publint @arethetypeswrong/cli`
Expected: both appear in root `package.json` devDependencies; `bun.lock`
updated.

- [x] **Step 2:** Ignore the staging directory. Append to root `.gitignore`:

```
e2e/packed-app/.staging/
```

## Task 02.2: Committed consumer template at `e2e/packed-app/`

- [x] **Step 1:** Create `e2e/packed-app/package.json` (do NOT add
  `e2e/packed-app` to root `workspaces` — exclusion is by omission):

```json
{
  "name": "animus-packed-app",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "build:vite": "vite build",
    "build:next": "next build"
  },
  "dependencies": {
    "@animus-ui/extract": "file:./tarballs/animus-ui-extract.tgz",
    "@animus-ui/next-plugin": "file:./tarballs/animus-ui-next-plugin.tgz",
    "@animus-ui/properties": "file:./tarballs/animus-ui-properties.tgz",
    "@animus-ui/system": "file:./tarballs/animus-ui-system.tgz",
    "@animus-ui/vite-plugin": "file:./tarballs/animus-ui-vite-plugin.tgz",
    "next": "^15.5.20",
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "typescript": "^5.6.0",
    "vite": "^8.1.4"
  },
  "overrides": {
    "@animus-ui/extract": "file:./tarballs/animus-ui-extract.tgz",
    "@animus-ui/next-plugin": "file:./tarballs/animus-ui-next-plugin.tgz",
    "@animus-ui/properties": "file:./tarballs/animus-ui-properties.tgz",
    "@animus-ui/system": "file:./tarballs/animus-ui-system.tgz",
    "@animus-ui/vite-plugin": "file:./tarballs/animus-ui-vite-plugin.tgz"
  }
}
```

`typescript` is deliberately stock stable TS, not the repo's tsgo preview —
this lane is the stable-TS declaration-consumption proof.

- [x] **Step 2:** Create the app sources. Model them on `e2e/vite-app/src/`
  (`ds.ts`, `App.tsx`, `main.tsx`, `index.html`) and the Next side on
  `e2e/next-app/` (`next.config.ts`, `app/`), with two changes:
  every `@animus-ui/test-ds` import is replaced by local component
  definitions built from `@animus-ui/system`, and the source exercises at
  least: one styled component with variants, one system-prop usage, and one
  dynamic prop (so extraction produces assertable CSS in both builds).
  `vite.config.ts` registers the packed `@animus-ui/vite-plugin`;
  `next.config.ts` wraps with the packed `@animus-ui/next-plugin` — mirror
  the fixtures' own configs, importing by package name (names resolve to
  the tarballs in staging).

- [x] **Step 3:** Create `e2e/packed-app/tsconfig.json` — strict, `noEmit`,
  `moduleResolution: "bundler"`, includes `src/` and both config files. No
  `paths` mappings (path mappings would defeat the published-declaration
  proof).

- [x] **Step 4:** Create `e2e/packed-app/scripts/assert-build.ts` — repo-side
  positional assertions, modeled on `e2e/vite-app/scripts/assert-build.ts`
  and `e2e/next-app/scripts/assert-build.ts` (import `@animus-ui/assertions`
  from the workspace), pointed at `e2e/packed-app/.staging/dist/` (Vite) and
  `e2e/packed-app/.staging/.next/` (Next), asserting the CSS produced by the
  Step-2 sources.

## Task 02.3: The tier script `scripts/verify/packed.sh`

- [x] **Step 1:** Create `scripts/verify/packed.sh` with this structure
  (follow the repo's fail-loud shape exactly):

```bash
#!/usr/bin/env bash
set -euo pipefail

# verify:packed — pack all five publishables, lint the tarballs, install
# into an isolated non-workspace consumer, prove loading/types/builds, and
# run repo-side assertions. Fail-loud contract per root CLAUDE.md.

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
source "$ROOT/scripts/verify/_preconditions.sh"

PKGS=(properties system extract vite-plugin next-plugin)

require_bun_install
require_fresh_napi
require_fresh_napi_v2
for p in "${PKGS[@]}"; do require_fresh_package_dist "$p"; done
require_fresh_package_dist _assertions
command -v npm >/dev/null 2>&1 || { echo "ERROR: npm missing. Run: install Node per .tool-versions" >&2; exit 1; }

STAGING="$ROOT/e2e/packed-app/.staging"
rm -rf "$STAGING"
mkdir -p "$STAGING/tarballs"

# 1. Pack + workspace-specifier guard
for p in "${PKGS[@]}"; do
  (cd "packages/$p" && bun pm pack --destination "$STAGING/tarballs")
done
for f in "$STAGING"/tarballs/*.tgz; do
  if tar -xzOf "$f" package/package.json | grep -q '"workspace:'; then
    echo "ERROR: $(basename "$f") retains a workspace: specifier. Fix bun pm pack usage or the package manifest." >&2
    exit 1
  fi
done
# Normalize to version-stable names the template's file: paths expect
for p in "${PKGS[@]}"; do
  src=$(ls "$STAGING"/tarballs/animus-ui-"$p"-*.tgz)
  mv "$src" "$STAGING/tarballs/animus-ui-$p.tgz"
done

# 2. Tarball lint
for p in "${PKGS[@]}"; do
  (cd "packages/$p" && bunx publint --pack bun --strict)
done
for p in "${PKGS[@]}"; do
  bunx attw "$STAGING/tarballs/animus-ui-$p.tgz"
done

# 3. Isolated install from the committed template
cp -R e2e/packed-app/package.json e2e/packed-app/tsconfig.json \
      e2e/packed-app/vite.config.ts e2e/packed-app/next.config.ts \
      e2e/packed-app/index.html e2e/packed-app/src e2e/packed-app/app \
      "$STAGING/"
(cd "$STAGING" && npm install --no-audit --no-fund)

# 4. Workspace-leakage + version assertions (G2)
leaks=$(find "$STAGING/node_modules/@animus-ui" -maxdepth 1 -type l 2>/dev/null || true)
if [ -n "$leaks" ]; then
  echo "ERROR: packed consumer resolved from workspace via symlink: $leaks" >&2
  exit 1
fi
for p in "${PKGS[@]}"; do
  packed_v=$(tar -xzOf "$STAGING/tarballs/animus-ui-$p.tgz" package/package.json | bun -e "const c=await new Response(Bun.stdin.stream()).text(); console.log(JSON.parse(c).version)")
  installed_v=$(node -p "require('$STAGING/node_modules/@animus-ui/$p/package.json').version")
  if [ "$packed_v" != "$installed_v" ]; then
    echo "ERROR: @animus-ui/$p installed $installed_v but tarball is $packed_v (registry substitution?)." >&2
    exit 1
  fi
done

# 5. Load proof: ESM + CJS + both engines
(cd "$STAGING" && node --input-type=module -e "
  for (const p of ['@animus-ui/properties','@animus-ui/system','@animus-ui/vite-plugin','@animus-ui/next-plugin','@animus-ui/extract']) {
    const m = await import(p);
    if (!m || Object.keys(m).length === 0) throw new Error('empty ESM module: ' + p);
  }
  console.log('ESM load ok');
")
(cd "$STAGING" && node -e "
  const v1 = require('@animus-ui/extract');
  if (typeof v1.analyzeProject !== 'function') throw new Error('v1 engine: analyzeProject missing from packed install');
  const v2 = require('@animus-ui/extract/engine-v2');
  if (typeof v2.ExtractEngine !== 'function') throw new Error('v2 engine: ExtractEngine missing from packed install');
  console.log('CJS + both engines ok');
")

# 6. Published-declaration type-check (stable TypeScript)
(cd "$STAGING" && ./node_modules/.bin/tsc -p tsconfig.json --noEmit)

# 7. Consumer builds
(cd "$STAGING" && npm run build:vite)
(cd "$STAGING" && npm run build:next)

# 8. Receipt
mkdir -p "$STAGING/receipts"
node -e "
  const fs = require('fs');
  const staging = process.argv[1];
  const vite = require(staging + '/node_modules/vite/package.json').version;
  const next = require(staging + '/node_modules/next/package.json').version;
  const receipts = [
    { lane: 'verify:packed:vite', host: 'vite', hostVersion: vite, mode: 'production', engineLoaded: 'v2', engineDefault: 'v2', engineOverride: false, packageForm: 'packed' },
    { lane: 'verify:packed:next', host: 'next', hostVersion: next, mode: 'production', engineLoaded: 'v2', engineDefault: 'v2', engineOverride: false, packageForm: 'packed' }
  ];
  fs.writeFileSync(staging + '/receipts/packed.json', JSON.stringify(receipts, null, 2));
" "$STAGING"

# 9. Repo-side positional assertions
exec bun run e2e/packed-app/scripts/assert-build.ts
```

Adjust flags against the installed versions if they have drifted
(`bunx publint --help`, `bunx attw --help`); the checks each stage performs
are the contract, per the change-level spec.

- [x] **Step 2:** `chmod +x scripts/verify/packed.sh`

- [x] **Step 3:** Register the tier in `vite.config.ts` `run.tasks`,
  adjacent to `'verify:parity'`:

```ts
      'verify:packed': {
        command: 'bash scripts/verify/packed.sh',
        cache: false,
      },
```

Also append `'verify:packed'` to the `dependsOn` arrays of
`_verify:full:after-build` and `_verify:ci:after-build` (Packed Tier
Composite Membership requirement).

## Task 02.4: Prove the lane

- [x] **Step 1:** Run: `bunx vp run verify:packed`
Expected: exits 0; staging contains five tarballs,
`node_modules/@animus-ui/*` real directories, `dist/`, `.next/`, and
`receipts/packed.json` with two receipt objects.
— PASS after inc 07 landed + three template/lane fixes (see journal):
`[packed-app:assert] all assertions passed`.

- [x] **Step 2:** Run the G2 check (fenced command in the Guardrail gate
  below). Expected: empty output. — PASS.

- [x] **Step 3:** Run the G4 check. Expected: non-zero exit,
  `ERROR: packages/system/dist/ missing. Run: bun run --filter '@animus-ui/system' build:ts`,
  and no rebuild occurred. — PASS (vp exit=1, exact message, no rebuild).

- [x] **Step 4:** Negative proof for the tarball-lint stage — covered by
  the G4 run: a removed dist is caught by the freshness PRECONDITION
  (`require_fresh_package_dist`), which fires before any pack/lint stage;
  additionally the lint stage itself proved live on first contact (publint
  --strict failed next-plugin, spawning inc 07). Recorded: precondition
  stage catches missing/stale dist; publint/attw stage catches manifest
  defects.

## Guardrail gate

- [x] G2: `find e2e/packed-app/.staging/node_modules/@animus-ui -maxdepth 1 -type l 2>/dev/null` — result: PASS (empty output; all `@animus-ui/*` entries are real directories from tarballs; versions match packed 0.1.0)
- [x] G4: `mv packages/system/dist packages/system/dist.bak && (vp run verify:packed; echo "exit=$?") ; mv packages/system/dist.bak packages/system/dist` — result: PASS (vp exit=1; `ERROR: packages/system/dist/ missing. Run: bun run --filter '@animus-ui/system' build:ts`; zero downstream stages ran — no npm install, no rebuild; dist restored)

## Output contract (inline mode — collapse into the checklists above; review by subagent on the diff)

- [ ] Plan checkboxes ticked to reflect actual completion
- [ ] Guardrail gate results recorded with output excerpts
- [ ] Proposed journal entries: expected at least one `signal` entry for
      DEF-1 (the receipt now documents actual tarball contents — note v1
      binaries globbed via `*.node` AND v2 via `crates/extract-v2/*.node`,
      with sizes), plus any surprise/friction from publint/attw findings
- [ ] Surfaced variables (spawn candidates): publint/attw findings that
      require manifest changes beyond this footprint are spawn candidates,
      not inline fixes

## Post-review addendum (orchestrator, 2026-07-14 21:41)

Four review objections accepted and fixed after the first green run:
- F1: registry platform packages leaked via optionalDependencies —
  defense-in-depth check now pins installed `@animus-ui/*` to the five
  packed names + exactly the optionals declared by the packed extract
  manifest (first attempt `--omit=optional` reverted: it broke
  lightningcss's optional native binary).
- F2: engine-binary-missing fail-loud PROVEN by fault injection in
  staging: v1 (local `.node` + platform package removed) throws the napi
  aggregate error; v2 throws its actionable platform-named error; both
  restored and reload cleanly.
- F3: receipts now MEASURE engine facts (override from staged configs,
  default from installed plugin code, fail-loud probe) — lane prints
  `verify:packed:vite=v2, verify:packed:next=v2`.
- E2: spec type-lint requirement reworded to per-package supported modes
  with scoped-exemption semantics; leakage lints clean.
Final state: `vp run verify:packed` exit 0 end-to-end.

## Spec authorship checklist (orchestrator; the tie-back before ticking)

- [ ] No spec text owed (envelope covers)
- [ ] Journal `signal` entry for DEF-1's resolving receipt appended
- [ ] Reorientation entry written (this is inline mode — run the
      adversarial stances per cadence K=3)
- [ ] Ticked registry row 02 in tasks.md with `· ticked: <timestamp>`
