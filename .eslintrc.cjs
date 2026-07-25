module.exports = {
  root: true,
  ignorePatterns: ['node_modules/', 'dist/', 'build/', '.next/', '**/next-env.d.ts'],
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
      },
    },
  ],
  rules: {
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-floating-promises': 'off',
    '@typescript-eslint/no-unsafe-member-access': 'off',
    '@typescript-eslint/no-unsafe-assignment': 'off',
    '@typescript-eslint/no-unsafe-call': 'off',
    '@typescript-eslint/no-unsafe-argument': 'off',
    '@typescript-eslint/require-await': 'off',
    '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
    'prefer-const': 'warn',
    'no-console': ['warn', { allow: ['log', 'warn', 'error'] }],
  },
};
