import { defineConfig } from 'vite-plus';

import type { OxlintOverride } from 'oxlint';

const typescriptTestTargets = [
  // The whole package root, so tests colocated in src/ are collected too.
  'packages/system',
  'packages/vite-plugin/tests',
  'packages/next-plugin/tests',
  'packages/cli/tests',
  'packages/unplugin/tests',
  'packages/properties/__tests__',
  'packages/_assertions/__tests__',
  'packages/_parity/__tests__',
  'packages/oracle/__tests__',
  'packages/extract/tests/session',
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
  'packages/extract/tests/source-corpus.test.ts',
  'packages/extract/tests/source-ingestion.test.ts',
  'packages/extract/tests/source-ingestor.test.ts',
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

// Exact files, never a glob: unaffected and new system files stay under
// anti-slop enforcement. An entry leaves the list as its file is migrated.
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
      'e2e/vinext-app/next-env.d.ts',
      // Change artifacts are governed by their own process, not by lint.
      'openspec/changes/**',
      // Corpus bytes are hashed into the parity baselines (`corpusSha256`), so
      // editing a fixture to satisfy a lint rule invalidates the oracle.
      'packages/_parity/corpus/**',
      // The emitter copies these two fixtures' transform source text verbatim
      // into generated code, and those bytes are hashed into the baselines.
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
        // Schema scripts are CLIs; console is their output surface.
        files: ['openspec/schemas/**'],
        rules: {
          'no-console': 'off',
          'no-shadow': 'off',
        },
      },
      {
        // The parity harness is a CLI; console is its output surface.
        files: [
          'packages/_parity/src/**',
          'packages/_parity/tools/**',
          'packages/_parity/corpus/**',
        ],
        rules: {
          'no-console': 'off',
          'no-unused-vars': 'off',
          // Corpus fixtures exercise shadowing as part of what they test.
          'no-shadow': 'off',
        },
      },
      {
        files: [
          'scripts/**/*.ts',
          'scripts/**/*.mjs',
          'e2e/*/scripts/**/*.ts',
          'e2e/*/scripts/**/*.mjs',
          'e2e/rollup-app/prototype/**/*.mjs',
        ],
        rules: {
          'no-console': 'off',
        },
      },
      {
        files: ['packages/oracle/src/cli.ts', 'packages/oracle/src/cli/**'],
        rules: {
          'no-console': 'off',
        },
      },
      {
        files: [
          'packages/next-plugin/src/**/*.ts',
          'packages/vite-plugin/src/**/*.ts',
          'packages/extract/session/**/*.ts',
          'packages/cli/src/**/*.ts',
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
      // Schema-governed artifacts; some are immutable once written.
      'openspec/**',
      '**/tmp/**',
      'legacy/**',
      // Next regenerates this on every build, so formatting it re-drifts.
      'e2e/next16-app/next-env.d.ts',
      // vinext typegen rewrites this each build with double-quoted imports
      // and compares bytes before writing; the tracked copy stays in that form.
      'e2e/vinext-app/next-env.d.ts',
      // Generated by napi build.
      'packages/extract/crates/extract-v2/index.js',
      'packages/extract/crates/extract-v2/index.d.ts',
      // Byte-precise fixtures; formatting destroys the properties they test.
      'packages/_parity/corpus/**',
      // Snapshots of emitted .animus output; formatting diverges them from it.
      'packages/oracle/__tests__/fixtures/**',
      'openspec/changes/archive/**/*.md',
      // repowise rewrites this file in its own formatting on every run.
      '.vscode/extensions.json',
      'tools/oxlint/anti-slop/**',
    ],
  },
  test: {
    environment: 'happy-dom',
    // The whole collection boundary for an untargeted `bunx vp test run`;
    // verify:unit:ts and verify:coverage:ts enumerate targets instead.
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
        // Routes through build:extract-v2, which gates the rustc channel on
        // rust-toolchain.toml; the package's own build reaches napi ungated.
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
        // Ordered on purpose: `dependsOn` has no ordering field, and naming
        // build:extract here would put two writers into extract's dist.
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
        // Ordered pipeline, not a `dependsOn` set: artifacts must exist before
        // the checks that read them, and the e2e fan-out has no task identity.
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
