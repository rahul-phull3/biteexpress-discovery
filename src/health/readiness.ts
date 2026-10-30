import type { Db } from 'mongodb';
import {
  describeError,
  MongoErrorCode,
  mongoErrorCode,
} from '../database/mongo-errors';
import {
  RESTAURANT_INDEX_NAMES,
  RESTAURANTS_COLLECTION,
  SEARCH_INDEX_NAME,
  type SearchIndexInfo,
} from '../database/restaurants.collection';

export interface ReadinessReport {
  /** ready: serve traffic here. unavailable: do not. */
  status: 'ready' | 'unavailable';
  timestamp: string;
  mongodb: { status: 'up' | 'down'; latencyMs?: number; error?: string };
  indexes: {
    status: 'ok' | 'missing' | 'unknown';
    present: string[];
    missing: string[];
    error?: string;
  };
  /** Reported, never a reason to fail readiness: search degrades gracefully. */
  search: {
    index: string;
    status: string;
    queryable: boolean;
    error?: string;
  };
}

const DEFAULT_TIMEOUT_MS = 2000;

/**
 * Asks MongoDB whether this instance can do its job right now: does it
 * answer, and do the indexes the queries rely on exist. Never throws, and
 * every question has a time limit, so a probe cannot hang on a sick database.
 */
export async function inspectReadiness(
  db: Db,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<ReadinessReport> {
  const timestamp = new Date().toISOString();
  const mongodb = await checkMongo(db, timeoutMs);

  if (mongodb.status === 'down') {
    return {
      status: 'unavailable',
      timestamp,
      mongodb,
      indexes: { status: 'unknown', present: [], missing: [] },
      search: { index: SEARCH_INDEX_NAME, status: 'UNKNOWN', queryable: false },
    };
  }

  const [indexes, search] = await Promise.all([
    checkIndexes(db, timeoutMs),
    checkSearchIndex(db, timeoutMs),
  ]);
  return {
    status: indexes.status === 'ok' ? 'ready' : 'unavailable',
    timestamp,
    mongodb,
    indexes,
    search,
  };
}

async function checkMongo(
  db: Db,
  timeoutMs: number,
): Promise<ReadinessReport['mongodb']> {
  const started = performance.now();
  try {
    await withTimeout(db.command({ ping: 1 }), timeoutMs, 'ping');
    return { status: 'up', latencyMs: Math.round(performance.now() - started) };
  } catch (error) {
    return { status: 'down', error: describeError(error) };
  }
}

async function checkIndexes(
  db: Db,
  timeoutMs: number,
): Promise<ReadinessReport['indexes']> {
  try {
    const found = await withTimeout(
      db.collection(RESTAURANTS_COLLECTION).listIndexes().toArray(),
      timeoutMs,
      'listIndexes',
    );
    const present = found.flatMap((index) =>
      typeof index.name === 'string' ? [index.name] : [],
    );
    const missing = RESTAURANT_INDEX_NAMES.filter(
      (name) => !present.includes(name),
    );
    return {
      status: missing.length === 0 ? 'ok' : 'missing',
      present,
      missing,
    };
  } catch (error) {
    if (mongoErrorCode(error) === MongoErrorCode.NamespaceNotFound) {
      // The collection does not exist yet, so none of its indexes do either.
      return {
        status: 'missing',
        present: [],
        missing: [...RESTAURANT_INDEX_NAMES],
      };
    }
    return {
      status: 'unknown',
      present: [],
      missing: [],
      error: describeError(error),
    };
  }
}

async function checkSearchIndex(
  db: Db,
  timeoutMs: number,
): Promise<ReadinessReport['search']> {
  try {
    const found: SearchIndexInfo[] = await withTimeout(
      db
        .collection(RESTAURANTS_COLLECTION)
        .listSearchIndexes(SEARCH_INDEX_NAME)
        .toArray(),
      timeoutMs,
      'listSearchIndexes',
    );
    const [index] = found;
    if (!index) {
      return { index: SEARCH_INDEX_NAME, status: 'MISSING', queryable: false };
    }
    return {
      index: SEARCH_INDEX_NAME,
      status: String(index.status ?? 'UNKNOWN'),
      queryable: index.queryable === true,
    };
  } catch (error) {
    return {
      index: SEARCH_INDEX_NAME,
      status: 'UNAVAILABLE',
      queryable: false,
      error: describeError(error),
    };
  }
}

function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms} ms`)),
      ms,
    );
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
