/**
 * How long one MongoDB read may run before the server stops it (`maxTimeMS`).
 * Two seconds is far above what the indexed queries need (milliseconds) and
 * far below the time a person waits before giving up, so a query that is
 * stuck behind a lunch-hour surge frees its resources instead of piling up.
 * Change it with READ_TIMEOUT_MS.
 */
export const DEFAULT_READ_TIMEOUT_MS = 2000;
