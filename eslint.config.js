// ESLint flat config — strict gates for the v2 codebase.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/.turbo/**',
      // Git worktrees created by Claude Code agents mirror the entire repo
      // under .claude/worktrees/. Linting them duplicates every error and
      // confuses scope (worktree paths don't match our scripts/** override).
      '.claude/worktrees/**',
      // Build / test runner configs live outside any tsconfig — type-aware
      // linting can't resolve them. They're small and well-known patterns.
      '**/*.config.{ts,js}',
      'vitest.workspace.ts',
      'vitest.shared.ts',
      '**/test/setup.ts',
      // Playwright specs use their own tsconfig in the e2e/ packages + the
      // Playwright test runner does its own type-check. ESLint type-aware
      // rules don't resolve them through the project service, so ignore them.
      'e2e/web/**',
      'e2e/desktop/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '.husky/**',
    ],
  },
  // Base JS rules apply everywhere.
  js.configs.recommended,
  // Type-aware TS rules ONLY on TS source files inside packages/apps that
  // belong to a tsconfig. Scoping to **/*.ts(x) avoids loading parserServices
  // for stray config .js files.
  {
    files: ['{apps,packages}/**/*.{ts,tsx}'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      'prefer-const': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  // Build scripts and Electron main/preload run in Node — give them the
  // node globals so `process`, `console`, `URL`, etc. resolve. This also
  // covers the Node automation scripts that ship inside committed Claude
  // Code skills (e.g. the release-manager bump-version script); the agent
  // worktrees under .claude/worktrees/** are excluded by the top ignores.
  {
    files: [
      '{apps,packages}/**/scripts/**/*.{js,mjs,cjs}',
      'scripts/**/*.{js,mjs,cjs}',
      '.claude/**/scripts/**/*.{js,mjs,cjs}',
      'apps/desktop/src/main/**/*.ts',
    ],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        URL: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
        queueMicrotask: 'readonly',
        fetch: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
    },
  },
  // Boundary code that handles untyped external input (MCP tool arguments
  // from arbitrary AI clients, JSON specs from arbitrary OpenAPI / Postman
  // / Insomnia files, Electron IPC events). The `no-unsafe-*` rules here
  // would force us to wrap every field access in a runtime guard or cast
  // chain — Zod already validates at the entry point of each MCP tool,
  // and the parsers each have warnings for the malformed cases.
  //
  // Provider implementations (in-memory / file-backed / in-process) match
  // an async interface even when their bodies are synchronous, so
  // `require-await` would force a contortion that adds no value.
  {
    files: [
      'packages/mcp-server/src/**/*.ts',
      'packages/mock-server-core/src/parsers/**/*.ts',
      'packages/mock-server-core/src/handlers/**/*.ts',
      'packages/mock-server-core/src/faker/**/*.ts',
      'apps/desktop/src/main/ipc/**/*.ts',
      'apps/desktop/src/main/preload.ts',
    ],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  },
  // Tests can use console freely and may need looser typing.
  {
    files: ['{apps,packages}/**/*.test.{ts,tsx}', '{apps,packages}/**/test/**/*.{ts,tsx}'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/unbound-method': 'off',
      // Tests often declare async arrow functions to satisfy a typed
      // resolver contract (Promise<T>) without needing to await internally.
      '@typescript-eslint/require-await': 'off',
      // Casts like `as HTMLTextAreaElement` are runtime-narrow truths the
      // static types don't capture (RTL's `getByLabelText` returns
      // HTMLElement). The auto-fixer would strip them and break tsc.
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
    },
  },
);
