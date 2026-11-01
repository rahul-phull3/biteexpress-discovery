/**
 * Dependency-injection tokens for MongoDB.
 *
 * MONGO_CLIENT is the one MongoClient for the whole process (it owns the
 * connection pool, so it must be created once and shared). MONGO_DB is the
 * application's database handle taken from that client.
 */
export const MONGO_CLIENT = Symbol('MONGO_CLIENT');
export const MONGO_DB = Symbol('MONGO_DB');

/**
 * The time limit of every read of the restaurant store, in milliseconds: the
 * READ_TIMEOUT_MS setting, provided by RestaurantsModule (see read-limits.ts).
 */
export const MONGO_READ_TIMEOUT_MS = Symbol('MONGO_READ_TIMEOUT_MS');
