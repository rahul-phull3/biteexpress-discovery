import { STATUS_CODES } from 'node:http';

/** Media type of an RFC 9457 error document. */
export const PROBLEM_JSON = 'application/problem+json';

/**
 * Stable names for the kinds of problem this API reports, so a client can
 * switch on `type` instead of parsing messages. They are URI references that
 * name the problem; nothing serves them yet, so read them as identifiers.
 */
export const ProblemType = {
  Validation: '/problems/validation-error',
  NotFound: '/problems/not-found',
  Conflict: '/problems/conflict',
  Internal: '/problems/internal-error',
  /** RFC 9457's default: the problem means nothing beyond its HTTP status. */
  Generic: 'about:blank',
} as const;

/** One faulty field, in the shape of the `errors` example in RFC 9457 section 3. */
export interface FieldError {
  /** A JSON Pointer (RFC 6901) to the faulty field of the JSON body, as a URI fragment: #/address/city */
  pointer?: string;
  /** The faulty path, query or header parameter. */
  parameter?: string;
  detail: string;
}

/** The error document every failure of this API returns (RFC 9457). */
export interface Problem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  /** The path of the request that failed. */
  instance?: string;
  /** The X-Request-Id of the response: quote it to find the log lines. */
  requestId?: string;
  errors?: FieldError[];
}

/**
 * Thrown by application code to make the API answer with a specific problem.
 * It carries HTTP semantics on purpose: the services are small and the
 * indirection of a domain error plus a translation table would not pay for
 * itself here.
 */
export class ProblemException extends Error {
  constructor(readonly problem: Omit<Problem, 'instance' | 'requestId'>) {
    super(problem.detail ?? problem.title);
    this.name = 'ProblemException';
  }
}

export function validationProblem(
  errors: FieldError[],
  detail = 'The request is not valid. See errors for each field.',
): ProblemException {
  return new ProblemException({
    type: ProblemType.Validation,
    title: 'Validation failed',
    status: 400,
    detail,
    errors,
  });
}

export function notFoundProblem(detail: string): ProblemException {
  return new ProblemException({
    type: ProblemType.NotFound,
    title: 'Not Found',
    status: 404,
    detail,
  });
}

export function conflictProblem(
  detail: string,
  errors?: FieldError[],
): ProblemException {
  return new ProblemException({
    type: ProblemType.Conflict,
    title: 'Conflict',
    status: 409,
    detail,
    ...(errors ? { errors } : {}),
  });
}

/** The parts of a validation issue this module reads. Zod's issues have them all. */
export interface IssueLike {
  readonly path: readonly PropertyKey[];
  readonly message: string;
  readonly code?: string;
  /** Present on Zod's "unrecognized_keys" issue: the names of the extra fields. */
  readonly keys?: readonly string[];
}

/**
 * Where a validated value came from, which decides how an error names it:
 * body fields get a JSON Pointer, anything else gets a parameter name.
 *  - 'body': a field of the JSON body.
 *  - 'query': the issue path starts with the query parameter name.
 *  - { parameter }: a single path or header parameter.
 */
export type ValidationTarget = 'body' | 'query' | { parameter: string };

/** Turns validation issues into the `errors` array of a problem. */
export function issuesToFieldErrors(
  issues: readonly IssueLike[],
  target: ValidationTarget = 'body',
): FieldError[] {
  return issues.flatMap((issue) => {
    if (issue.code === 'unrecognized_keys' && issue.keys?.length) {
      return issue.keys.map((key) =>
        fieldError(
          target,
          [...issue.path, key],
          `Unknown field "${key}". Remove it.`,
        ),
      );
    }
    return [fieldError(target, issue.path, issue.message)];
  });
}

function fieldError(
  target: ValidationTarget,
  path: readonly PropertyKey[],
  detail: string,
): FieldError {
  if (target === 'body') return { pointer: toPointer(path), detail };
  if (target === 'query') {
    return { parameter: path.map(String).join('.'), detail };
  }
  return { parameter: target.parameter, detail };
}

/** A JSON Pointer in URI fragment form: [] is "#", ["a", "b/c"] is "#/a/b~1c". */
export function toPointer(path: readonly PropertyKey[]): string {
  return (
    '#' +
    path
      .map(
        (segment) =>
          '/' + String(segment).replace(/~/g, '~0').replace(/\//g, '~1'),
      )
      .join('')
  );
}

export interface ErrorContext {
  instance?: string;
  requestId?: string;
}

/** What the exception filter should send. */
export type ErrorResponse =
  /** An RFC 9457 document, sent as application/problem+json. */
  | { kind: 'problem'; problem: Problem }
  /** A body that the code which threw shaped on purpose (the /ready report), sent untouched. */
  | { kind: 'custom'; status: number; body: object };

/** The two members of a Nest HttpException that this module needs. */
interface HttpExceptionLike {
  getStatus(): number;
  getResponse(): string | object;
}

function isHttpExceptionLike(value: unknown): value is HttpExceptionLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    'getStatus' in value &&
    typeof value.getStatus === 'function' &&
    'getResponse' in value &&
    typeof value.getResponse === 'function'
  );
}

/** An error from the http-errors package, which Express and body-parser throw (for example "payload too large"). */
function clientErrorStatus(value: unknown): number | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const candidate =
    'statusCode' in value
      ? value.statusCode
      : 'status' in value
        ? value.status
        : undefined;
  return typeof candidate === 'number' && candidate >= 400 && candidate < 500
    ? candidate
    : undefined;
}

function statusText(status: number): string {
  return STATUS_CODES[status] ?? 'Error';
}

/**
 * Decides what the client is told about a failure.
 *
 *  - Our own ProblemException: sent as it is.
 *  - A Nest HttpException with Nest's standard body (a message, such as "Cannot
 *    GET /x" or a malformed-JSON message): turned into a problem.
 *  - A Nest HttpException whose author shaped the body (GET /ready throws one
 *    carrying its report): that body is respected and sent untouched.
 *  - A 4xx error from Express or body-parser: turned into a problem.
 *  - Anything else is a bug. The client gets a 500 that says nothing about it;
 *    the filter logs the real error with the request id.
 */
export function toErrorResponse(
  exception: unknown,
  context: ErrorContext = {},
): ErrorResponse {
  if (exception instanceof ProblemException) {
    return problemResponse(exception.problem, context);
  }

  if (isHttpExceptionLike(exception)) {
    const status = exception.getStatus();
    const body = exception.getResponse();
    if (typeof body === 'string') {
      return problemResponse(genericProblem(status, body), context);
    }
    if (isNestErrorBody(body)) {
      return problemResponse(
        genericProblem(status, messageOf(body.message), body.error),
        context,
      );
    }
    return { kind: 'custom', status, body };
  }

  const clientStatus = clientErrorStatus(exception);
  if (clientStatus !== undefined) {
    const message = (exception as { message?: unknown }).message;
    return problemResponse(
      genericProblem(
        clientStatus,
        typeof message === 'string' ? message : undefined,
      ),
      context,
    );
  }

  return problemResponse(
    {
      type: ProblemType.Internal,
      title: 'Internal Server Error',
      status: 500,
      detail:
        'The server hit an unexpected error. Quote the request id when you report it.',
    },
    context,
  );
}

function genericProblem(
  status: number,
  detail?: string,
  title?: unknown,
): Omit<Problem, 'instance' | 'requestId'> {
  return {
    type: status === 404 ? ProblemType.NotFound : ProblemType.Generic,
    title: typeof title === 'string' && title !== '' ? title : statusText(status),
    status,
    ...(detail ? { detail } : {}),
  };
}

function problemResponse(
  problem: Omit<Problem, 'instance' | 'requestId'>,
  context: ErrorContext,
): ErrorResponse {
  return {
    kind: 'problem',
    problem: {
      ...problem,
      ...(context.instance ? { instance: context.instance } : {}),
      ...(context.requestId ? { requestId: context.requestId } : {}),
    },
  };
}

/** Nest's standard error body: { statusCode, message, error }. */
interface NestErrorBody {
  statusCode: number;
  message: unknown;
  error?: unknown;
}

function isNestErrorBody(body: object): body is NestErrorBody {
  return (
    'statusCode' in body && typeof body.statusCode === 'number' && 'message' in body
  );
}

function messageOf(message: unknown): string | undefined {
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) return message.map(String).join('; ');
  return undefined;
}
