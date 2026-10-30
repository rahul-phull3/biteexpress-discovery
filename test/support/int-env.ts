// Runs before each integration test file is loaded (see "setupFiles" in
// test/jest-int.json).
//
// 1. Read the developer's .env into this test's own process.env, so the tests
//    reach the same MongoDB as the app. A variable that is already set wins.
// 2. Point the app at a throwaway database, so your development data is never
//    touched. The tests drop it when they finish.
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

try {
  const fromFile = parseEnv(readFileSync('.env', 'utf8'));
  for (const [key, value] of Object.entries(fromFile)) {
    if (value !== undefined && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
} catch {
  // No .env file: the built-in defaults apply.
}

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
process.env.MONGODB_DB = `biteexpress_it_${suffix}`;
