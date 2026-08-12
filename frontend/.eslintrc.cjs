module.exports = {
  root: true,
  env: {
    browser: true,
    es2021: true,
    node: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true,
    },
  },
  plugins: ['@typescript-eslint', 'react-hooks', 'react-refresh'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', 'node_modules'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'react-hooks/exhaustive-deps': 'off',
    'react-refresh/only-export-components': 'off',

    /*
     * Colours must be able to follow the theme.
     *
     * theme.css remaps `bg-white` and the neutral scale for dark mode, but it
     * cannot reach a colour literal baked into a Tailwind arbitrary-value
     * class — `bg-[#fff]`, `border-[#e5e7eb]`, `bg-[rgba(248,250,252,.9)]`.
     * Those stay light in dark mode. The CSV drop target shipped exactly that
     * and flashed a white slab around a dark card; three picker components
     * shipped borders that measured 1.17:1 against their own background.
     *
     * `bg-[var(--token)]` is fine and deliberately still allowed — that IS the
     * theme. Only baked-in hex/rgb/hsl values are rejected.
     *
     * If a literal is genuinely correct — a switch knob that must stay white in
     * both themes, a fixed-palette marketing surface — disable the rule on that
     * line WITH a comment saying why, the way ToggleInput does.
     */
    /*
     * warn, not error: 127 existing sites carry this and are not all being
     * fixed today. It surfaces in the editor and in review for anything new,
     * without adding 127 failures to a lint run that is already red.
     */
    'no-restricted-syntax': [
      'warn',
      {
        selector:
          'Literal[value=/(bg|text|border|from|via|to|ring|shadow|fill|stroke|decoration|outline)-\\[[^\\]]*(#[0-9a-fA-F]{3,8}|rgba?\\(|hsla?\\()/]',
        message:
          'Hardcoded colour in a Tailwind arbitrary class — theme.css cannot remap it, so it will not follow dark mode. Use a semantic token (bg-surface-card, border-border-strong, text-on-brand) or bg-[var(--your-token)].',
      },
      {
        selector:
          'TemplateElement[value.raw=/(bg|text|border|from|via|to|ring|shadow|fill|stroke|decoration|outline)-\\[[^\\]]*(#[0-9a-fA-F]{3,8}|rgba?\\(|hsla?\\()/]',
        message:
          'Hardcoded colour in a Tailwind arbitrary class — theme.css cannot remap it, so it will not follow dark mode. Use a semantic token (bg-surface-card, border-border-strong, text-on-brand) or bg-[var(--your-token)].',
      },
    ],
  },
};
