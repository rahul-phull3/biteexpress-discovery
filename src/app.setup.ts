import type { INestApplication } from '@nestjs/common';
import { API_PREFIX } from './http/api-prefix';
import { ProblemDetailsFilter } from './http/problem-details.filter';
import { requestContext } from './http/request-context';

/**
 * App-wide settings shared by main.ts and the e2e tests, so the tests see the
 * same routes, headers and error format as production.
 *
 *  - The API lives under /v1. Health and readiness probes stay at the root.
 *  - Every request gets an X-Request-Id and one access-log line.
 *  - Every failure is answered as application/problem+json (RFC 9457).
 */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix(API_PREFIX, { exclude: ['health', 'ready'] });
  app.use(requestContext());
  app.useGlobalFilters(new ProblemDetailsFilter());
}
