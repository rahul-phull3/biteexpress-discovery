/**
 * Thrown when MongoDB stopped a read because it ran past its time limit
 * (READ_TIMEOUT_MS, sent with every read as `maxTimeMS`).
 *
 * It lives in its own file, away from the MongoDB store, so that the HTTP layer
 * can recognise it without importing the driver: problem.ts turns it into a
 * 503 with a Retry-After header. The original driver error is kept as `cause`
 * for the log.
 */
export class QueryTimeoutError extends Error {
  constructor(
    /** The limit that was exceeded, in milliseconds. */
    readonly limitMs: number,
    options?: ErrorOptions,
  ) {
    super(`A database read ran past its limit of ${limitMs} ms.`, options);
    this.name = 'QueryTimeoutError';
  }
}
