import { z } from 'zod';

/**
 * Single source of truth for configuration. ConfigModule validates the
 * environment (process.env plus .env) against this schema when the app boots,
 * so a bad value stops the process immediately instead of failing later.
 * Coercion and defaults apply to what ConfigService returns.
 *
 * A later step adds DEFAULT_TENANT_ID here.
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
});

export type Env = z.infer<typeof envSchema>;
