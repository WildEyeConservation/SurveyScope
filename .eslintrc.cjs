module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  // hello-world is an unused AWS toolkit scaffold carrying its own eslintrc
  // that pulls in a plugin this repo does not install, which blocked the lint
  // run for the whole repository.
  ignorePatterns: ['dist', '.eslintrc.cjs', 'amplify/functions/hello-world'],
  parser: '@typescript-eslint/parser',
  plugins: ['react-refresh'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: [
              '**/Context',
              '**/Context.tsx',
              '**/UserContext',
              '**/UserContext.js',
              '**/UserContext.tsx',
            ],
            message:
              'Use session, data hooks, or stores instead of the legacy contexts.',
          },
        ],
      },
    ],
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],
  },
}
