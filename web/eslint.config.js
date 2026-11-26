import js from '@eslint/js';
import prettier from 'eslint-config-prettier/flat';
import boundaries from 'eslint-plugin-boundaries';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// ADR-0001, "Teste de arquitetura": uma feature só entra em outra pelo index.ts.
const featureEntry = { element: { type: 'feature', fileInternalPath: 'index.ts' } };
const sameFeature = {
  element: { type: 'feature', captured: { feature: '{{ from.element.captured.feature }}' } },
};
const shared = { element: { type: 'shared' } };

const pureTsMessage =
  'ADR-0001: application/, model/, shared/lib/design, shared/lib/api e shared/lib/money.ts são TypeScript puro (sem React, React Flow, TanStack Query, Zustand ou HTTP).';

export default defineConfig([
  globalIgnores(['dist', 'coverage', 'playwright-report', 'test-results']),
  js.configs.recommended,
  tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  { languageOptions: { globals: globals.browser } },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { boundaries },
    settings: {
      'boundaries/root-path': import.meta.dirname,
      'import/resolver': { node: { extensions: ['.ts', '.tsx', '.js'] } },
      'boundaries/elements': [
        { type: 'app', pattern: 'src/app', partialMatch: false },
        { type: 'feature', pattern: 'src/features/*', partialMatch: false, capture: ['feature'] },
        { type: 'shared', pattern: 'src/shared', partialMatch: false },
      ],
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          policies: [
            { from: { element: { type: 'app' } }, allow: { to: [featureEntry, shared] } },
            {
              from: { element: { type: 'feature' } },
              allow: { to: [sameFeature, featureEntry, shared] },
            },
            { from: shared, allow: { to: shared } },
          ],
        },
      ],
    },
  },
  {
    files: [
      'src/**/application/**',
      'src/**/model/**',
      'src/shared/lib/design/**',
      'src/shared/lib/api/**',
      'src/shared/lib/money.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: pureTsMessage },
            { name: 'react-dom', message: pureTsMessage },
            { name: 'zustand', message: pureTsMessage },
          ],
          patterns: [
            {
              group: [
                'react/*',
                'react-dom/*',
                '@xyflow/*',
                '@tanstack/*',
                'zustand/*',
                // Qualquer módulo http, inclusive '../http' a partir de shared/lib.
                '**/http',
                '**/http/*',
              ],
              message: pureTsMessage,
            },
          ],
        },
      ],
    },
  },
  prettier,
]);
