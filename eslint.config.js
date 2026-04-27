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
      // Build / test runner configs live outside any tsconfig — type-aware
      // linting can't resolve them. They're small and well-known patterns.
      '**/*.config.{ts,js}',
      'vitest.workspace.ts',
      'vitest.shared.ts',
      '**/test/setup.ts',
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
      '@typescript-eslint/unbound-method': 'off',
      // Tests often declare async arrow functions to satisfy a typed
      // resolver contract (Promise<T>) without needing to await internally.
      '@typescript-eslint/require-await': 'off',
    },
  },
);
