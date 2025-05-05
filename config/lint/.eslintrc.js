module.exports = {
  env: {
    node: true,
    es2021: true,
    jest: true, // Add jest environment
  },
  extends: [
    'airbnb-base',
    'plugin:prettier/recommended', // Integrates Prettier with ESLint
  ],
  parserOptions: {
    ecmaVersion: 12,
    sourceType: 'module',
  },
  rules: {
    'prettier/prettier': 'warn', // Show Prettier errors as warnings
    'no-console': process.env.NODE_ENV === 'production' ? 'warn' : 'off', // Allow console in dev
    'no-debugger': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
    // Add any project-specific overrides here
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_|^next$' }], // Allow unused 'next' in Express middleware
    'no-shadow': 'warn', // Might want to adjust later
    'import/prefer-default-export': 'off', // Allow named exports
    'no-underscore-dangle': 'off', // Allow underscores (common in some libs/conventions)
    'class-methods-use-this': 'off', // Allow class methods that don't use 'this'
  },
  ignorePatterns: ['node_modules/', 'dist/', 'coverage/'], // Ignore build/dependency folders
}; 