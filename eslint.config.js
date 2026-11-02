import js from '@eslint/js';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'apps/api/src/generated/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-console': 'off',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: [
      'apps/api/**/*.ts',
      'scripts/**/*.mjs',
      'prisma.config.ts',
      'e2e/**/*.ts',
      'playwright.config.ts',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/api/src/types/**/*.d.ts'],
    rules: { '@typescript-eslint/no-namespace': 'off' },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      // Labels are associated through the Field component's id wiring.
      'jsx-a11y/label-has-associated-control': ['error', { assert: 'either', depth: 3 }],
      // The login email field is the only control on the page and is autofocused on purpose.
      'jsx-a11y/no-autofocus': 'off',
    },
  },
);
