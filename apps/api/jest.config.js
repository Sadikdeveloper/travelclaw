/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  testRegex: 'test/.*\\.test\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleNameMapper: {
    '^@travelclaw/shared$': '<rootDir>/../../packages/shared/src/index.ts',
    '^@travelclaw/agent-core$': '<rootDir>/../../packages/agent-core/src/index.ts',
  },
};
