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

// 3. The words of a sentence are matched by the plain rules here, whatever .env
//    says. Atlas Search indexes a new restaurant a moment after it was written,
//    which would make every "create it, then search for it" test flaky. The one
//    test that exercises Atlas Search builds its own AtlasTextSearch and waits
//    for the index (test/atlas-text-search.int-spec.ts).
process.env.SEARCH_ENGINE = 'rules';
