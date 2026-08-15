/** @type {import('jest').Config} */
// transformIgnorePatterns is intentionally left to jest-expo's preset
// default rather than the commonly-copied RN template regex — that regex
// assumes npm/yarn's flat node_modules layout and misses pnpm's `.pnpm/`
// store path, which broke transforms for @react-native/jest-preset itself.
module.exports = {
  preset: 'jest-expo',
  testPathIgnorePatterns: ['/node_modules/', '/.expo/'],
};
