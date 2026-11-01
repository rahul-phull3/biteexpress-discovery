/** MongoDB server error codes this app reacts to. */
export const MongoErrorCode = {
  NamespaceNotFound: 26,
  NamespaceExists: 48,
  IndexOptionsConflict: 85,
  IndexKeySpecsConflict: 86,
  /** The operation ran past the `maxTimeMS` it was sent with, and the server stopped it. */
  MaxTimeMSExpired: 50,
  /** A unique index refused the write: the value already exists. */
  DuplicateKey: 11000,
} as const;

/** The numeric `code` of a MongoDB server error, or undefined for anything else. */
export function mongoErrorCode(error: unknown): number | undefined {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'number'
  ) {
    return error.code;
  }
  return undefined;
}

/** True when MongoDB stopped the operation because it ran past its `maxTimeMS`. */
export function isQueryTimeout(error: unknown): boolean {
  return mongoErrorCode(error) === MongoErrorCode.MaxTimeMSExpired;
}

/** A one-line description of an error that is safe to log or return. */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
