/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // `lucide-react/dynamic` is ESM-only (a bare `export * from
    // './dynamic.mjs'` shim — lucide can't ship an exports map, see
    // lucide-icons/lucide#2743). Jest's CJS runtime can't parse it and
    // transforming the 1,500-lazy-import module would slow every suite;
    // IconWidget (Wave B / editor-crush B5, 2026-07-02) + PropertiesPanel
    // import it and variants-register pulls both into most builder suites.
    '^lucide-react/dynamic$': '<rootDir>/test-mocks/lucide-react-dynamic.tsx',
  },
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      tsconfig: {
        jsx: 'react-jsx',
        esModuleInterop: true,
        module: 'commonjs',
        target: 'es2020',
        moduleResolution: 'node',
        skipLibCheck: true,
      },
    }],
  },
  // jest-dom matchers must be registered after the test framework initializes.
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testMatch: ['**/__tests__/**/*.test.(ts|tsx)'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
};
