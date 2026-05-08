import { defineConfig } from 'vite-plus';

export default defineConfig({
  lint: {
    plugins: ['react', 'jsx-a11y', 'nextjs', 'import'],
    categories: {
      correctness: 'error',
      suspicious: 'error',
    },
    rules: {
      'react/react-in-jsx-scope': 'off',
      'import/no-unassigned-import': 'off',
      'react-hooks/exhaustive-deps': 'error',
      'react/no-array-index-key': 'error',
      'no-console': 'error',
    },
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
        files: ['scripts/**/*.ts', 'e2e/*/scripts/**/*.ts'],
        rules: {
          'no-console': 'off',
        },
      },
      {
        files: [
          'packages/next-plugin/src/**/*.ts',
          'packages/vite-plugin/src/**/*.ts',
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
  test: {
    environment: 'happy-dom',
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*',
      '**/legacy/**',
      '**/target/**',
      '**/.next/**',
      '**/.animus/**',
      '**/.hygiene/**',
      '**/tmp/**',
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
        command:
          'bunx vp test run packages/system/__tests__ packages/vite-plugin/tests packages/properties/__tests__ packages/_assertions/__tests__',
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
        dependsOn: ['verify:build:next'],
        cache: false,
      },
      'verify:assert:showcase': {
        command: 'bash scripts/verify/assert-showcase.sh',
        dependsOn: ['verify:build:showcase'],
        cache: false,
      },
      'verify:assert:vite': {
        command: 'bash scripts/verify/assert-vite.sh',
        dependsOn: ['verify:build:vite'],
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
      'test:run': {
        command: 'bunx vp test run',
        cache: false,
      },

      clean: {
        command: 'rm -rf packages/*/dist packages/extract/target',
        cache: false,
      },
      'clean:light': {
        command: 'rm -rf node_modules/.vite packages/*/dist',
        cache: false,
      },
      'clean:full': {
        command:
          'rm -rf node_modules/.vite packages/*/dist packages/extract/target packages/extract/*.node',
        cache: false,
      },
    },
  },
});
