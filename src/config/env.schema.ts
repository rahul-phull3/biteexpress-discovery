import { z } from 'zod';

/**
 * Single source of truth for configuration. ConfigModule validates the
 * environment (process.env plus .env) against this schema when the app boots,
 * so a bad value stops the process immediately instead of failing later.
 * Coercion and defaults apply to what ConfigService returns.
 *
 * Later steps add MONGODB_URI, MONGODB_DB and DEFAULT_TENANT_ID here.
 */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
});

export type Env = z.infer<typeof envSchema>;
