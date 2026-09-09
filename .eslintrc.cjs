module.exports = {
  root: true,
  ignorePatterns: [
    'node_modules/',
    'dist/',
    'build/',
    '.next/',
    '**/next-env.d.ts',
    // Apps Android (Capacitor): no pertenecen a ningún tsconfig del monorepo.
    'apps/**',
    // Utilidades dev / scripts / tests que no pertenecen a ningún tsconfig del
    // monorepo (no se compilan ni se despliegan): se excluyen del lint.
    'packages/backend/**/*.test.ts',
    'packages/backend/test_prisma.ts',
    'packages/backend/test-db.ts',
    'packages/backend/test-api.ts',
    'packages/backend/test_hours_job.ts',
    'packages/backend/seed.ts',
    'packages/backend/create-admin.ts',
    'packages/backend/scripts/migrate-categories.ts',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
    project: [
      './packages/backend/tsconfig.json',
      './packages/shared/tsconfig.json',
      './packages/web-admin/tsconfig.json',
      './packages/web-restaurant/tsconfig.json',
      './packages/web-customer/tsconfig.json',
      './packages/web-driver/tsconfig.json',
    ],
    tsconfigRootDir: __dirname,
    ecmaFeatures: {
      jsx: true,
    },
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
  ],
  overrides: [
    {
      files: [
        'packages/web-admin/**/*.{ts,tsx}',
        'packages/web-restaurant/**/*.{ts,tsx}',
        'packages/web-customer/**/*.{ts,tsx}',
        'packages/web-driver/**/*.{ts,tsx}',
      ],
      extends: ['next/core-web-vitals'],
      rules: {
        '@next/next/no-sync-scripts': 'off',
        // next/core-web-vitals la eleva a error; se mantiene como aviso para no
        // bloquear por escapado de comillas en JSX heredado.
        'react/no-unescaped-entities': 'warn',
      },
    },
  ],
  rules: {
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    '@typescript-eslint/no-floating-promises': 'off',
    '@typescript-eslint/no-unsafe-member-access': 'off',
    '@typescript-eslint/no-unsafe-assignment': 'off',
    '@typescript-eslint/no-unsafe-call': 'off',
    '@typescript-eslint/no-unsafe-argument': 'off',
    // Consistentes con las demás reglas no-unsafe-* ya desactivadas: el codebase
    // legacy usa `any` y retornos no comprobados de forma intencional.
    '@typescript-eslint/no-unsafe-return': 'off',
    '@typescript-eslint/require-await': 'off',
    '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
    // Los `catch {}` intencionales (best-effort localStorage, etc.) son válidos.
    'no-empty': ['error', { allowEmptyCatch: true }],
    // El backend usa require() a propósito y hay casts redundantes heredados.
    '@typescript-eslint/no-var-requires': 'off',
    '@typescript-eslint/no-unnecessary-type-assertion': 'off',
    '@typescript-eslint/no-redundant-type-constituents': 'off',
    '@typescript-eslint/ban-ts-comment': 'off',
    '@typescript-eslint/restrict-template-expressions': 'off',
    'react/no-unescaped-entities': 'warn',
    'prefer-const': 'warn',
    'no-console': ['warn', { allow: ['log', 'warn', 'error'] }],
  },
};
