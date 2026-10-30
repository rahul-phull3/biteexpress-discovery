import type { Db } from 'mongodb';
import { describeError, MongoErrorCode, mongoErrorCode } from './mongo-errors';
import {
  RESTAURANT_INDEXES,
  RESTAURANTS_COLLECTION,
  restaurantsSearchDefinition,
  restaurantValidator,
  SEARCH_INDEX_NAME,
  type SearchIndexInfo,
} from './restaurants.collection';

export interface BootstrapLogger {
  log(message: string): void;
  warn(message: string): void;
}

const collectionSettings = {
  validator: restaurantValidator,
  // strict: check every insert and every update. error: refuse a bad write
  // (the alternative, warn, only logs it).
  validationLevel: 'strict',
  validationAction: 'error',
} as const;

/**
 * Brings the database in line with what the code expects: the collection and
 * its validator, the regular indexes, and the Atlas Search index when the
 * deployment supports it. Safe to run on every start and from several
 * instances at once.
 *
 * Trade-off: the app needs the right to create collections and indexes. A
 * production deployment would run this as a migration step with its own
 * credentials and give the API read/write access only.
 */
export async function ensureRestaurantsSchema(
  db: Db,
  logger: BootstrapLogger,
): Promise<void> {
  await ensureCollection(db, logger);
  await ensureIndexes(db, logger);
  await ensureSearchIndex(db, logger);
}

async function ensureCollection(
  db: Db,
  logger: BootstrapLogger,
): Promise<void> {
  const existing = await db
    .listCollections({ name: RESTAURANTS_COLLECTION }, { nameOnly: true })
    .toArray();

  if (existing.length === 0) {
    try {
      await db.createCollection(RESTAURANTS_COLLECTION, collectionSettings);
      logger.log(
        `Created collection "${RESTAURANTS_COLLECTION}" with its $jsonSchema validator`,
      );
      return;
    } catch (error) {
      // Another instance created it between our check and our create. Carry
      // on and bring its validator up to date.
      if (mongoErrorCode(error) !== MongoErrorCode.NamespaceExists) throw error;
    }
  }

  await db.command({ collMod: RESTAURANTS_COLLECTION, ...collectionSettings });
  logger.log(
    `Updated the $jsonSchema validator on "${RESTAURANTS_COLLECTION}"`,
  );
}

async function ensureIndexes(db: Db, logger: BootstrapLogger): Promise<void> {
  try {
    const names = await db
      .collection(RESTAURANTS_COLLECTION)
      .createIndexes(RESTAURANT_INDEXES);
    logger.log(`Indexes in place: ${names.join(', ')}`);
  } catch (error) {
    const code = mongoErrorCode(error);
    if (
      code === MongoErrorCode.IndexOptionsConflict ||
      code === MongoErrorCode.IndexKeySpecsConflict
    ) {
      throw new Error(
        `An index on "${RESTAURANTS_COLLECTION}" already exists with a different definition (${describeError(error)}). ` +
          'Drop that index, or wipe the local data with: npm run db:reset',
        { cause: error },
      );
    }
    throw error;
  }
}

/**
 * Atlas Search is optional. A plain MongoDB has no search process and refuses
 * these commands, which must not stop the API from starting: search falls back
 * to the rule-based path. So every failure here is logged, not thrown.
 */
async function ensureSearchIndex(
  db: Db,
  logger: BootstrapLogger,
): Promise<void> {
  const collection = db.collection(RESTAURANTS_COLLECTION);
  try {
    const existing: SearchIndexInfo[] = await collection
      .listSearchIndexes(SEARCH_INDEX_NAME)
      .toArray();
    if (existing.length > 0) {
      const status = String(existing[0]?.status ?? 'unknown');
      logger.log(
        `Search index "${SEARCH_INDEX_NAME}" already exists (status: ${status})`,
      );
      return;
    }
    await collection.createSearchIndex({
      name: SEARCH_INDEX_NAME,
      definition: restaurantsSearchDefinition,
    });
    logger.log(
      `Search index "${SEARCH_INDEX_NAME}" requested; it builds in the background`,
    );
  } catch (error) {
    logger.warn(
      `Atlas Search index "${SEARCH_INDEX_NAME}" was not created: ${describeError(error)}. ` +
        'The API still starts and search falls back to the rule-based path.',
    );
  }
}
