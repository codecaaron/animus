import { defineConfig } from 'vite-plus';

export default defineConfig({
  lint: {
    ignorePatterns: [
      '**/node_modules/**',
      '**/.next/**',
      '**/.animus/**',
      '**/.hygiene/**',
      '**/dist/**',
      '**/target/**',
      '**/tmp/**',
      'legacy/**',
      'packages/extract/index.js',
      'packages/extract/index.d.ts',
      'e2e/next-app/next-env.d.ts',
    ],
    overrides: [
      {
        files: ['**/*.test-d.{ts,tsx}'],
        rules: {
          'no-unused-expressions': 'off',
        },
      },
      {
        files: ['packages/extract/tests/fixtures/**'],
        rules: {
          'no-unused-vars': 'off',
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
    ignorePatterns: [
      '**/node_modules/**',
      '**/.next/**',
      '**/.animus/**',
      '**/.hygiene/**',
      '**/dist/**',
      '**/target/**',
      '**/tmp/**',
      'legacy/**',
      'packages/extract/index.js',
      'packages/extract/index.d.ts',
      'openspec/changes/archive/**/*.md',
    ],
  },
  run: {
    tasks: {
      'verify:lint': {
        command: 'bunx vp lint && bunx vp fmt --check',
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
      'verify:unit:ts': {
        command: 'bash scripts/verify/unit-ts.sh',
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
      'verify:build:next': {
        command: 'bash scripts/verify/build-next.sh',
        cache: false,
      },
      'verify:build:showcase': {
        command: 'bash scripts/verify/build-showcase.sh',
        cache: false,
      },
      'verify:build:vite': {
        command: 'bash scripts/verify/build-vite.sh',
        cache: false,
      },
      'verify:assert:next': {
        command: 'bash scripts/verify/assert-next.sh',
        cache: false,
      },
      'verify:assert:showcase': {
        command: 'bash scripts/verify/assert-showcase.sh',
        cache: false,
      },
      'verify:assert:vite': {
        command: 'bash scripts/verify/assert-vite.sh',
        cache: false,
      },

      'build:extract': {
        command: "bun run --filter '@animus-ui/extract' build",
        cache: false,
      },
      'build:ts': {
        command: "bun run --filter './packages/*' build:ts",
        cache: false,
      },
      'build:all': {
        command: 'echo "build:all complete"',
        dependsOn: ['build:extract', 'build:ts'],
        cache: false,
      },
      'build:showcase': {
        command: "bun run --filter './packages/showcase' build",
        dependsOn: ['build:ts'],
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
          'verify:canary',
        ],
        cache: false,
      },
      'verify:full': {
        command: 'echo "verify:full complete"',
        dependsOn: [
          'verify:lint',
          'verify:compile',
          'verify:types',
          'verify:unit:ts',
          'verify:unit:rust',
          'verify:canary',
          'verify:integration',
          'verify:build:next',
          'verify:build:showcase',
          'verify:build:vite',
          'verify:assert:next',
          'verify:assert:showcase',
          'verify:assert:vite',
        ],
        cache: false,
      },
      'verify:ci': {
        command: 'echo "verify:ci complete"',
        dependsOn: [
          'verify:lint',
          'verify:unit:rust',
          'verify:hygiene:rust',
          'build:extract',
          'build:ts',
          'verify:compile',
          'verify:types',
          'verify:unit:ts',
          'verify:canary',
          'verify:integration',
          'verify:build:showcase',
          'verify:assert:showcase',
          'verify:build:vite',
          'verify:assert:vite',
        ],
        cache: false,
      },
      'verify:next': {
        command: 'echo "verify:next complete"',
        dependsOn: ['verify:build:next', 'verify:assert:next'],
        cache: false,
      },
      'verify:showcase': {
        command: 'echo "verify:showcase complete"',
        dependsOn: ['verify:build:showcase', 'verify:assert:showcase'],
        cache: false,
      },
      'verify:vite': {
        command: 'echo "verify:vite complete"',
        dependsOn: ['verify:build:vite', 'verify:assert:vite'],
        cache: false,
      },

      hygiene: {
        command: 'bash scripts/hygiene/run.sh',
        cache: false,
      },
    },
  },
});
