import { type ArgumentsHost, Catch, type ExceptionFilter, Logger } from '@nestjs/common';
import { PROBLEM_JSON, toErrorResponse } from './problem';

/** The members of the request this filter reads. Express provides them. */
interface RequestLike {
  method?: string;
  originalUrl?: string;
  url?: string;
}

/** The members of the response this filter writes. Express provides them. */
interface ResponseLike {
  headersSent?: boolean;
  locals?: Record<string, unknown>;
  status(code: number): ResponseLike;
  setHeader(name: string, value: string): unknown;
  json(body: unknown): unknown;
}

/**
 * The one place where a failure becomes an HTTP response. Registered globally
 * in app.setup.ts, so a validation error, an unknown route, a malformed JSON
 * body and a bug all answer in the same RFC 9457 format. The decisions are in
 * toErrorResponse (problem.ts); this class only writes the result.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<RequestLike>();
    const response = http.getResponse<ResponseLike>();

    const requestId =
      typeof response.locals?.requestId === 'string'
        ? response.locals.requestId
        : undefined;
    const instance = pathOf(request.originalUrl ?? request.url);
    const result = toErrorResponse(exception, { instance, requestId });
    const status = result.kind === 'problem' ? result.problem.status : result.status;

    if (status >= 500) {
      // The client only sees a generic message for a bug; the log has the truth.
      this.logger.error(
        `${request.method ?? '?'} ${instance ?? '?'} failed with ${status} requestId=${requestId ?? '-'}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }
    if (response.headersSent) return; // Too late to change anything; the log line above is what is left.

    if (result.kind === 'custom') {
      response.status(result.status).json(result.body);
      return;
    }
    response.setHeader('Content-Type', PROBLEM_JSON);
    // An error must never be cached as if it were the resource.
    response.setHeader('Cache-Control', 'no-store');
    response.status(result.problem.status).json(result.problem);
  }
}

/** The path of a URL without its query string, which can carry values that do not belong in a response. */
function pathOf(url: string | undefined): string | undefined {
  return url?.split('?')[0];
}
