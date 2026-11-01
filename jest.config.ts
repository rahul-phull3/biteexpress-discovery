import type { Config } from 'jest';

// Unit tests: *.spec.ts anywhere in the project. The e2e tests have their own
// config in test/jest-e2e.json and are run with `npm run test:e2e`.
//
// Plain `jest`, no Node flags: NestJS is on its CommonJS 11 line, so nothing
// here needs Node's experimental ES-module support (see D21 in docs/DECISIONS.md).
const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.spec.ts',
    // Entry points that only start a process; there is nothing to unit test in them.
    '!src/main.ts',
    '!src/importer/main.ts',
    '!src/importer/build-text-fixes.main.ts',
  ],
  coverageDirectory: './coverage',
  // lcov is what SonarQube reads (npm run sonar:scan); text-summary prints the totals.
  coverageReporters: ['text-summary', 'lcov'],
  testEnvironment: 'node',
};

export default config;
