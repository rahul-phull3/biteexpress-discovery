import type { Config } from 'jest';

// Unit tests: *.spec.ts anywhere in the project. The e2e tests have their own
// config in test/jest-e2e.json and are run with `npm run test:e2e`.
const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  collectCoverageFrom: ['src/**/*.(t|j)s'],
  coverageDirectory: './coverage',
  testEnvironment: 'node',
};

export default config;
