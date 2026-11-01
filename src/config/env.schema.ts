import { z } from 'zod';
import { DEFAULT_READ_TIMEOUT_MS } from '../database/read-limits';

/**
 * A tenant id is stored on every restaurant and leads every index. Letters,
 * digits, underscore and hyphen keep it safe in logs and URLs; 64 is the
 * length the collection validator allows.
 */
export const TENANT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Single source of truth for configuration. ConfigModule validates the
 * environment (process.env plus .env) against this schema when the app boots
 * (through validateEnv below), so a bad value stops the process immediately
 * instead of failing later. Coercion and defaults apply to what ConfigService
 * returns.
 *
 * The importer reads the same schema, so `npm run import` and the API agree on
 * the database and the tenant.
 */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  // The default is the Atlas Local container from docker-compose.yml, reached
  // from your machine. directConnection=true is required for that container:
  // it is a one-node replica set that advertises a hostname your machine
  // cannot resolve, so the driver must not try to discover the members.
  MONGODB_URI: z
    .string()
    .regex(
      /^mongodb(\+srv)?:\/\/.+/,
      'must start with mongodb:// or mongodb+srv://',
    )
    .default('mongodb://127.0.0.1:27017/?directConnection=true'),
  // Atlas limits database names to 38 characters.
  MONGODB_DB: z
    .string()
    .regex(
      /^[A-Za-z0-9_-]{1,38}$/,
      'use 1 to 38 letters, digits, underscores or hyphens',
    )
    .default('biteexpress'),

  // The tenant whose restaurants this process reads and writes. The importer
  // stamps it on every document; the API scopes every query to it.
  DEFAULT_TENANT_ID: z
    .string()
    .regex(
      TENANT_ID_PATTERN,
      'use 1 to 64 letters, digits, underscores or hyphens',
    )
    .default('biteexpress'),

  // The time limit of every MongoDB read, in milliseconds (maxTimeMS). A read
  // that runs longer is stopped by the server and answered with a 503 and a
  // Retry-After header. Below 100 ms a healthy query could fail; above a
  // minute the limit protects nothing.
  READ_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(60_000)
    .default(DEFAULT_READ_TIMEOUT_MS),

  // How the leftover words of a search sentence ("vada pav") are matched.
  // atlas: with Atlas Search (typo tolerant), falling back to rules when the
  //        search index is not ready, and saying so in the answer.
  // rules: always by plain text matching on the name and the area.
  SEARCH_ENGINE: z.enum(['atlas', 'rules']).default('atlas'),

  // Serve the Swagger UI at /docs and the OpenAPI document at
  // /docs/openapi.json. Turn it off for a deployment that is public.
  DOCS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
});

export type Env = z.infer<typeof envSchema>;

/**
 * What ConfigModule calls with the raw environment. Returns the validated
 * values (defaults applied, numbers as numbers), or throws one error that
 * names every variable that is wrong.
 */
export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (result.success) return result.data;

  const problems = result.error.issues.map(
    (issue) =>
      `  ${issue.path.map(String).join('.') || '(environment)'}: ${issue.message}`,
  );
  throw new Error(`Invalid configuration:\n${problems.join('\n')}`);
}
