import type { INestApplication } from '@nestjs/common';

/**
 * App-wide settings shared by main.ts and the e2e tests, so the tests see the
 * same routes as production. Later steps register the global validation pipe
 * and the error filter here.
 *
 * The API lives under /v1. Health and readiness probes stay at the root.
 */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('v1', { exclude: ['health', 'ready'] });
}
