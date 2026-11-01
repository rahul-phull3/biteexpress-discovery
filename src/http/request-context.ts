import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';

/** The header that carries the id, in requests and in responses. */
export const REQUEST_ID_HEADER = 'X-Request-Id';

/** What a caller may send as its own id: short and free of anything that could forge a log line. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

/** Probe paths are called every few seconds and say nothing useful in an access log. */
const QUIET_PATHS = new Set(['/health', '/ready']);

/** Keeps the id the caller sent when it is safe; otherwise makes a new one. */
export function chooseRequestId(incoming: string | string[] | undefined): string {
  return typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming)
    ? incoming
    : randomUUID();
}

/** The members of an Express request this middleware reads. */
interface RequestLike {
  method?: string;
  originalUrl?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
}

/** The members of an Express response this middleware uses. */
interface ResponseLike {
  statusCode: number;
  locals: Record<string, unknown>;
  setHeader(name: string, value: string): unknown;
  on(event: 'finish', listener: () => void): unknown;
}

export type AccessLog = (line: string) => void;

function nestAccessLog(): AccessLog {
  const logger = new Logger('http');
  return (line) => logger.log(line);
}

/**
 * Middleware for every request: gives it an id, returns the id in the
 * X-Request-Id header, keeps it in res.locals.requestId for the error filter,
 * and writes one access-log line when the response is done:
 *
 *   POST /v1/restaurants 201 12.4ms requestId=6f1c...
 *
 * The error filter adds the same id to its log line and to the body of every
 * problem, so one id finds everything about a request.
 */
export function requestContext(log: AccessLog = nestAccessLog()) {
  return (req: RequestLike, res: ResponseLike, next: () => void): void => {
    const requestId = chooseRequestId(req.headers[REQUEST_ID_HEADER.toLowerCase()]);
    res.setHeader(REQUEST_ID_HEADER, requestId);
    res.locals.requestId = requestId;

    const started = performance.now();
    res.on('finish', () => {
      const url = req.originalUrl ?? req.url ?? '';
      if (QUIET_PATHS.has(url.split('?')[0] ?? '')) return;
      const elapsed = (performance.now() - started).toFixed(1);
      log(`${req.method ?? '?'} ${url.split('?')[0]} ${res.statusCode} ${elapsed}ms requestId=${requestId}`);
    });
    next();
  };
}
