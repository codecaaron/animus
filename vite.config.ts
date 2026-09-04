import { defineConfig } from 'vite-plus';

import type { OxlintOverride } from 'oxlint';

const typescriptTestTargets = [
  // Owned-root discovery (design decision D8): the whole system package root so
  // colocated src/ tests cannot be silently omitted from the tier.
  'packages/system',
  'packages/vite-plugin/tests',
  'packages/next-plugin/tests',
  'packages/cli/tests',
  'packages/unplugin/tests',
  'packages/properties/__tests__',
  'packages/_assertions/__tests__',
  'packages/_parity/__tests__',
  'packages/oracle/__tests__',
  // Every engine-free extractor test, enumerated — the tests/ dir is NOT
  // globbed wholesale because two of its files require a fresh NAPI binary
  // (canary.test.ts and static-css-overrides.test.ts) and run via `bun test`
  // in verify:canary instead; this tier's only prerequisite is `bun install`.
  // A new extract test goes HERE unless it loads the native engine.
  'packages/extract/tests/asset-placeholders.test.ts',
  'packages/extract/tests/collect-external-packages.test.ts',
  'packages/extract/tests/core-options.test.ts',
  'packages/extract/tests/correlate-external-tokens.test.ts',
  'packages/extract/tests/discover-packages.test.ts',
  'packages/extract/tests/dynamic-prop-config.test.ts',
  'packages/extract/tests/error-diagnostics.test.ts',
  'packages/extract/tests/files-json-decode.test.ts',
  'packages/extract/tests/manifest-diagnostics.test.ts',
  'packages/extract/tests/path-aliases.test.ts',
  'packages/extract/tests/post-process-css.test.ts',
  'packages/extract/tests/replacement-plans.test.ts',
  'packages/extract/tests/resolve-asset.test.ts',
  'packages/extract/tests/source-identity.test.ts',
  'packages/extract/tests/source-ingestion.test.ts',
  'packages/extract/tests/svelte-source-adapter.test.ts',
  'packages/extract/tests/svelte-source-origin.test.ts',
  'packages/extract/tests/timing-waterfall.test.ts',
  'packages/extract/tests/tsconfig-paths.test.ts',
  'packages/extract/tests/vocabulary-witness-diagnostics.test.ts',
  'packages/extract/tests/watch-keys.test.ts',
  'scripts/verify/owner-graph.test.ts',
  'scripts/verify/ci-graph.test.ts',
  'scripts/verify/extract-test-enumeration.test.ts',
] as const;
const typescriptTestTargetArguments = typescriptTestTargets.join(' ');
const typescriptTestCommand = `bunx vp test run ${typescriptTestTargetArguments}`;
const typescriptCoverageExclusions = [
  '**/dist/**',
  'legacy/**',
  'packages/extract/index*.js',
  '**/__tests__/**',
  '**/tests/**',
  '**/__fixtures__/**',
] as const;
const typescriptCoverageExclusionArguments = typescriptCoverageExclusions
  .map((pattern) => `--coverage.exclude='${pattern}'`)
  .join(' ');

// Agent scratch trees. One question — "this is an agent's working directory,
// no repo tool reads, rewrites, or collects from it" — so one list, spread into
// every tool surface that has to answer it (lint, fmt, test). Adding a new
// agent directory here admits it to all three at once; the non-agent entries in
// each surface below diverge deliberately and stay local to that surface.
const agentScratchDirectories = [
  '.agent/**',
  '.agents/**',
  '.claude/**',
  '.codex/**',
  '.continue/**',
  '.cursor/**',
  '.gemini/**',
  '.opencode/**',
  '.pi/**',
  '.playwright-mcp/**',
  '.repowise/**',
  '.roo/**',
  '.windsurf/**',
] as const;

// TEMPORARY: campaign-close protected-core freeze. Remove each exact file as
// it is independently migrated; do not replace this list with a system glob,
// so unaffected and newly added system files remain under anti-slop enforcement.
const temporaryProtectedCoreAntiSlopOverride = {
  files: [
    'packages/system/__tests__/types.test-d.tsx',
    'packages/system/src/Animus.ts',
    'packages/system/src/AnimusExtended.ts',
    'packages/system/src/SystemBuilder.ts',
    'packages/system/src/appearance/index.ts',
    'packages/system/src/asset.ts',
    'packages/system/src/bootstrap/createAppearanceBootstrap.ts',
    'packages/system/src/compose.ts',
    'packages/system/src/composeWithContext.ts',
    'packages/system/src/conditions.ts',
    'packages/system/src/keyframes.ts',
    'packages/system/src/runtime/assert-root-slot.ts',
    'packages/system/src/runtime/createClassResolver.ts',
    'packages/system/src/runtime/createComposedFamily.ts',
    'packages/system/src/runtime/index.ts',
    'packages/system/src/runtime/is-dev.ts',
    'packages/system/src/runtime/resolveClasses.ts',
    'packages/system/src/runtime/witness.ts',
    'packages/system/src/scales/createScale.ts',
    'packages/system/src/selectors.ts',
    'packages/system/src/theme/createTheme.ts',
    'packages/system/src/theme/flattenScale.ts',
    'packages/system/src/theme/resolveReferences.ts',
    'packages/system/src/theme/serializeTokens.ts',
    'packages/system/src/theme/types.ts',
    'packages/system/src/theme/utils.ts',
    'packages/system/src/transforms/border.ts',
    'packages/system/src/transforms/createTransform.ts',
    'packages/system/src/transforms/grid.ts',
    'packages/system/src/transforms/size.ts',
    'packages/system/src/types/component.ts',
    'packages/system/src/types/props.ts',
    'packages/system/src/types/theme.ts',
    'packages/system/src/utils/deepMerge.ts',
  ],
  rules: {
    'anti-slop/no-chained-type-assertions': 'off',
    'anti-slop/no-conditional-empty-object-spread': 'off',
    'anti-slop/no-known-value-widening': 'off',
    'anti-slop/no-module-mocking': 'off',
    'anti-slop/no-object-parameters': 'off',
    'anti-slop/no-reflect-apply': 'off',
    'anti-slop/no-reflect-get': 'off',
    'anti-slop/no-runtime-typeof': 'off',
    'anti-slop/no-shape-in-symbol-names': 'off',
    'anti-slop/no-unknown-parameters': 'off',
    'anti-slop/no-unknown-returns': 'off',
    'anti-slop/no-unknown-type-aliases': 'off',
    'anti-slop/no-unsafe-dictionary-type': 'off',
    'anti-slop/no-widen-then-assert': 'off',
    'anti-slop/require-safety-comment-for-type-assertion': 'off',
  },
} satisfies OxlintOverride;

export default defineConfig({
  lint: {
    plugins: ['react', 'jsx-a11y', 'nextjs', 'import'],
    jsPlugins: [
      {
        name: 'anti-slop',
        specifier: './tools/oxlint/anti-slop/index.ts',
      },
    ],
    categories: {
      correctness: 'error',
      suspicious: 'error',
    },
    rules: {
      'anti-slop/no-chained-type-assertions': 'error',
      'anti-slop/no-conditional-empty-object-spread': 'error',
      'anti-slop/no-known-value-widening': 'error',
      'anti-slop/no-module-mocking': 'error',
      'anti-slop/no-object-parameters': 'error',
      'anti-slop/no-reflect-apply': 'error',
      'anti-slop/no-reflect-get': 'error',
      'anti-slop/no-runtime-typeof': 'error',
      'anti-slop/no-shape-in-symbol-names': 'error',
      'anti-slop/no-unknown-parameters': 'error',
      'anti-slop/no-unknown-returns': 'error',
      'anti-slop/no-unknown-type-aliases': 'error',
      'anti-slop/no-unsafe-dictionary-type': 'error',
      'anti-slop/no-widen-then-assert': 'error',
      'anti-slop/require-safety-comment-for-type-assertion': 'error',
      'react/react-in-jsx-scope': 'off',
      'import/no-unassigned-import': 'off',
      'react-hooks/exhaustive-deps': 'error',
      'react/no-array-index-key': 'error',
      'no-console': 'error',
      'no-underscore-dangle': 'off',
    },
    ignorePatterns: [
      ...agentScratchDirectories,
      '**/node_modules/**',
      '**/.next/**',
      '**/.animus/**',
      '**/.hygiene/**',
      '**/.wrangler/**',
      '**/.react-router/**',
      '**/dist/**',
      '**/build/**',
      '**/target/**',
      '**/tmp/**',
      'legacy/**',
      'e2e/next-app/next-env.d.ts',
      'e2e/next16-app/next-env.d.ts',
      // OpenSpec CHANGE artifacts (journals, evidence tools) are
      // change-governed; schema executable scripts stay linted via the
      // override below.
      'openspec/changes/**',
      // Parity corpus fixtures are byte-precise adversarial extraction/
      // formatting fixtures, not code subject to the rule — the same
      // rationale scripts/verify/topology.ts states for its own
      // `packages/_parity/corpus` EXCLUDE_PREFIXES entry, and the same
      // reason the fmt ignorePatterns below excludes them. Their bytes are
      // hashed into the parity baselines (`corpusSha256`), so editing one to
      // satisfy a lint rule would invalidate the oracle. Scoped to the corpus
      // only: `packages/_parity/src`, `tools`, and `__tests__` stay linted.
      'packages/_parity/corpus/**',
      // Same pinned-bytes rationale, one file each: these two fixtures carry
      // transform functions whose SOURCE TEXT the emitter copies verbatim
      // into generated code, and those exact bytes are recorded in
      // packages/_parity/baselines under `corpusSha256`. Rewriting their
      // one flagged `typeof` each would break verify:parity until a baseline
      // refresh — an owner decision, not a lint fix.
      'packages/extract/tests/fixtures/custom-props.tsx',
      'packages/_integration/fixtures/components/transforms.tsx',
      'tools/oxlint/anti-slop/**',
    ],
    overrides: [
      temporaryProtectedCoreAntiSlopOverride,
      {
        files: ['**/*.test-d.{ts,tsx}'],
        rules: {
          'no-unused-expressions': 'off',
          'jsx-a11y/prefer-tag-over-role': 'off',
        },
      },
      {
        files: ['packages/showcase/src/components/docs/ColorPalette.tsx'],
        rules: {
          'jsx-a11y/interactive-supports-focus': 'off',
          'jsx-a11y/prefer-tag-over-role': 'off',
        },
      },
      {
        files: ['packages/extract/tests/fixtures/**'],
        rules: {
          'no-unused-vars': 'off',
          'jsx-a11y/anchor-has-content': 'off',
          'react-hooks/exhaustive-deps': 'off',
        },
      },
      {
        // Schema-shipped CLI tooling: console IS the interface.
        files: ['openspec/schemas/**'],
        rules: {
          'no-console': 'off',
          'no-shadow': 'off',
        },
      },
      {
        // Parity harness is a CLI (scoreboard output) — console is its UI,
        // matching the scripts/** precedent below.
        files: [
          'packages/_parity/src/**',
          'packages/_parity/tools/**',
          'packages/_parity/corpus/**',
        ],
        rules: {
          'no-console': 'off',
          'no-unused-vars': 'off',
          // corpus fixtures deliberately exercise shadowing (usage-semantics family)
          'no-shadow': 'off',
        },
      },
      {
        files: [
          'scripts/**/*.ts',
          'scripts/**/*.mjs',
          'e2e/*/scripts/**/*.ts',
          'e2e/*/scripts/**/*.mjs',
          // The rollup-app DEF-1 prototype record (retained per inc 05):
          // measure.mjs is a measurement CLI — console is its UI, same
          // rationale as scripts/** above.
          'e2e/rollup-app/prototype/**/*.mjs',
        ],
        rules: {
          'no-console': 'off',
        },
      },
      {
        // The oracle CLI: console IS the interface (human report on stderr,
        // machine JSON on stdout), matching the cli/** precedent below.
        files: ['packages/oracle/src/cli.ts', 'packages/oracle/src/cli/**'],
        rules: {
          'no-console': 'off',
        },
      },
      {
        files: [
          'packages/next-plugin/src/**/*.ts',
          'packages/vite-plugin/src/**/*.ts',
          // The extraction session moved here from next-plugin/src
          // (openspec: standalone-extraction-cli D1); its console logging is
          // the plugin-host interface. The CLI's stream-discipline work
          // routes its own output explicitly.
          'packages/extract/session/**/*.ts',
          // The CLI: console IS the interface (stderr for humans, stdout
          // only for --print-config JSON — spec'd stream discipline).
          'packages/cli/src/**/*.ts',
          // The unplugin transform host is a plugin host too: its loud-skip
          // warning surface (e.g. an esbuild build with no write target for
          // the stylesheet asset) is console, same as the plugins above.
          'packages/unplugin/src/**/*.ts',
        ],
        rules: {
          'no-console': 'off',
        },
      },
    ],
  },
  fmt: {
    semi: true,
    singleQuote: true,
    jsxSingleQuote: false,
    tabWidth: 2,
    printWidth: 80,
    trailingComma: 'es5',
    arrowParens: 'always',
    endOfLine: 'lf',
    bracketSpacing: true,
    bracketSameLine: false,
    useTabs: false,
    sortImports: {
      customGroups: [
        {
          groupName: 'react-libs',
          elementNamePattern: ['react', 'react-**'],
        },
      ],
      groups: [
        'react-libs',
        ['value-builtin', 'value-external'],
        'value-internal',
        ['value-parent', 'value-sibling', 'value-index'],
        'unknown',
      ],
    },
    ignorePatterns: [
      ...agentScratchDirectories,
      '**/node_modules/**',
      '**/.next/**',
      '**/.animus/**',
      '**/.hygiene/**',
      '**/.wrangler/**',
      '**/.react-router/**',
      '**/dist/**',
      '**/build/**',
      '**/target/**',
      // OpenSpec artifacts are schema-governed (brainstorm.md is immutable
      // once design.md exists); keep the repo formatter out of them.
      'openspec/**',
      '**/tmp/**',
      'legacy/**',
      // Next regenerates this on every build; keep the formatter out so the
      // fixture doesn't re-drift after each `next build` (same rationale as
      // the lint ignore for e2e/next-app/next-env.d.ts).
      'e2e/next16-app/next-env.d.ts',
      // v2 NAPI loader surface is generated by napi build (same rationale
      // as the v1 pair above).
      'packages/extract/crates/extract-v2/index.js',
      'packages/extract/crates/extract-v2/index.d.ts',
      // Parity corpus fixtures are byte-precise adversarial inputs (e.g.
      // no-eof-newline.tsx); formatting would destroy their properties.
      'packages/_parity/corpus/**',
      // Oracle fixtures are byte-pristine snapshots of emitted .animus
      // artifacts; formatting would diverge them from what animus emits.
      'packages/oracle/__tests__/fixtures/**',
      'openspec/changes/archive/**/*.md',
      // repowise update rewrites this file with its extension recommendation
      // in its own formatting on every run; keep the formatter out of the
      // tug-of-war.
      '.vscode/extensions.json',
      'tools/oxlint/anti-slop/**',
    ],
  },
  test: {
    environment: 'happy-dom',
    // This list is the WHOLE collection boundary for a bare `bunx vp test run`
    // (root `package.json` "test" passes no targets). verify:unit:ts and
    // verify:coverage:ts are safe by construction — both enumerate
    // typescriptTestTargets above — so a gap here shows up only in the
    // untargeted command, which is why the agent block and `**/build/**` were
    // missing until now.
    exclude: [
      ...agentScratchDirectories,
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*',
      '**/legacy/**',
      '**/target/**',
      '**/.next/**',
      '**/.animus/**',
      '**/.hygiene/**',
      '**/.wrangler/**',
      '**/.react-router/**',
      '**/tmp/**',
    ],
  },
  run: {
    tasks: {
      'verify:lint': {
        command:
          'bunx vp lint && bunx vp fmt --check && bun scripts/verify/topology.ts',
        cache: false,
      },
      'verify:compile': {
        command: 'bash scripts/verify/compile.sh',
        cache: false,
      },
      'verify:types': {
        command: 'bash scripts/verify/types.sh',
        cache: false,
      },
      'verify:unit:rust': {
        command: 'bash scripts/verify/unit-rust.sh',
        cache: false,
      },
      'verify:clippy': {
        command: 'bash scripts/verify/clippy.sh',
        cache: false,
      },
      'verify:unit:ts': {
        command: typescriptTestCommand,
        cache: false,
      },
      'verify:coverage:ts': {
        command: `bunx vitest run ${typescriptTestTargetArguments} --coverage.enabled --coverage.provider=v8 --coverage.reporter=text --coverage.reporter=lcov --coverage.reportsDirectory=coverage/ts ${typescriptCoverageExclusionArguments}`,
        cache: false,
      },
      'verify:coverage:e2e': {
        command: 'bash scripts/verify/coverage-e2e.sh',
        cache: false,
      },
      'verify:workers:contracts': {
        command: 'bash scripts/verify/workers-contracts.sh',
        cache: false,
      },
      'verify:hygiene:rust': {
        command: 'bash scripts/verify/hygiene-rust.sh',
        cache: false,
      },
      'verify:canary': {
        command: 'bash scripts/verify/canary.sh',
        cache: false,
      },
      'verify:integration': {
        command: 'bash scripts/verify/integration.sh',
        cache: false,
      },
      'verify:assert:vinext': {
        command: 'vp run @animus-ui/vinext-app#verify:assert',
        cache: false,
      },
      'verify:assert:react-router': {
        command: 'vp run @animus-ui/react-router-app#verify:assert',
        cache: false,
      },
      'build:extract': {
        // The NAPI half routes through build:extract-v2 — i.e. through
        // scripts/cloudflare/build-extract-v2.sh, which asserts `rustc
        // --version` equals the rust-toolchain.toml channel BEFORE building and
        // calls that channel the single source of truth. Calling the extract
        // package's own `build` here instead would reach `napi build --release`
        // with no channel check, leaving a second, ungated path to the shipped
        // .node. `build:v2:debug` stays ungated on purpose: a developer-profile
        // binary, not the shipped artifact.
        command:
          "vp run build:extract-v2 && bun run --filter '@animus-ui/extract' build:ts",
        cache: false,
      },
      'build:extract-v2': {
        command: 'bash scripts/cloudflare/build-extract-v2.sh',
        cache: false,
      },
      'verify:parity': {
        command: 'bash scripts/verify/parity.sh',
        cache: false,
      },
      'verify:packed': {
        command: 'bash scripts/verify/packed.sh',
        cache: false,
      },
      'build:ts': {
        command: "bun run --filter './packages/*' build:ts",
        cache: false,
      },
      'build:all': {
        // Ordered, not a dependency set: `dependsOn` has no ordering field, so
        // `['build:extract', 'build:ts']` let two writers into
        // packages/extract/dist at once (build:extract carries extract's
        // build:ts, and build:ts fans out over every package including
        // extract). Naming the NAPI-only gate task here instead of
        // build:extract also drops that duplicate write entirely: the fan-out
        // is the one build:ts writer for every package. Same phase order the
        // spec requires (Rust NAPI first, then TS in dependency order) and the
        // same ordered-chain mechanism verify:full uses.
        command: 'vp run build:extract-v2 && vp run build:ts',
        cache: false,
      },
      build: {
        command: 'echo "build alias for build:ts"',
        dependsOn: ['build:ts'],
        cache: false,
      },

      verify: {
        command: 'echo "verify complete"',
        dependsOn: [
          'verify:lint',
          'verify:compile',
          'verify:types',
          'verify:unit:ts',
          'verify:unit:rust',
          'verify:clippy',
          'verify:canary',
          'verify:workers:contracts',
        ],
        cache: false,
      },
      'verify:full': {
        // Deliberately NOT `dependsOn`, and not foldable into `verify` above.
        // `verify` is a fan-out gate: an unordered set of independent checks,
        // which is exactly what `dependsOn` models. This is an ordered pipeline
        // — artifacts must exist before the checks that read them — and
        // `dependsOn` has no ordering field. Its middle step is also a
        // package-filtered fan-out (`-F './e2e/*' …`), which has no task
        // identity and therefore no `dependsOn` spelling at all. The two lists
        // drift independently by design; that is the cost of the split, not a
        // bug to consolidate away.
        command:
          "vp run build:extract-v2 && vp run build:ts && vp run verify && vp run --fail-if-no-match -F './e2e/*' -F '!animus-packed-app' -F './packages/showcase' verify && vp run verify:parity && vp run verify:integration && vp run verify:hygiene:rust && vp run verify:packed",
        cache: false,
      },
      hygiene: {
        command: 'bash scripts/hygiene/run.sh',
        cache: false,
      },
      'test:run': {
        command: 'bunx vp test run',
        cache: false,
      },

      clean: {
        command:
          'rm -rf packages/*/dist packages/extract/crates/extract-v2/target packages/extract/crates/system-loader/target',
        cache: false,
      },
      'clean:light': {
        command: 'rm -rf node_modules/.vite packages/*/dist',
        cache: false,
      },
      'clean:full': {
        command:
          'rm -rf node_modules/.vite packages/*/dist packages/extract/crates/extract-v2/target packages/extract/crates/system-loader/target packages/extract/crates/extract-v2/*.node',
        cache: false,
      },
    },
  },
});
