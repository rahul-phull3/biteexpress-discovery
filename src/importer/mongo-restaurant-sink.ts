import type {
  AnyBulkWriteOperation,
  Collection,
  Document,
  UpdateFilter,
} from 'mongodb';
import { SOURCE_SYSTEM, type ImportedRestaurant } from './imported-restaurant';
import type {
  BatchOutcome,
  CollectionSummary,
  RestaurantSink,
  WriteFailure,
} from './restaurant-sink';

/**
 * The bulk operation that stores one restaurant: find it by tenant plus source
 * system plus source id, create it if it is not there, otherwise bring its
 * imported fields up to date.
 *
 * - On an insert MongoDB builds the new document from the equality conditions
 *   of the filter, so tenantId and source need no mention in the update.
 * - createdAt is set only when the document is created; updatedAt every time.
 * - A restaurant without a location has the field removed, so a location that
 *   an earlier run stored cannot outlive a corrected rule.
 * - Fields the importer does not own are left untouched.
 */
export function toUpsert(
  restaurant: ImportedRestaurant,
  tenantId: string,
  now: Date,
): AnyBulkWriteOperation<Document> {
  const { source, location, ...fields } = restaurant;
  const set: Document = { ...fields, updatedAt: now };
  const update: UpdateFilter<Document> = {
    $set: set,
    $setOnInsert: { createdAt: now },
  };
  if (location) {
    set.location = location;
  } else {
    update.$unset = { location: '' };
  }
  return {
    updateOne: {
      filter: {
        tenantId,
        'source.system': source.system,
        'source.id': source.id,
      },
      update,
      upsert: true,
    },
  };
}

export class MongoRestaurantSink implements RestaurantSink {
  constructor(
    private readonly collection: Collection<Document>,
    private readonly tenantId: string,
    private readonly now: Date,
  ) {}

  async upsertBatch(
    batch: readonly ImportedRestaurant[],
  ): Promise<BatchOutcome> {
    if (batch.length === 0) {
      return { inserted: 0, matched: 0, modified: 0, failures: [] };
    }
    const operations = batch.map((restaurant) =>
      toUpsert(restaurant, this.tenantId, this.now),
    );
    try {
      // ordered: false keeps going after a refused document, so one bad row
      // costs one row, not the rest of the batch.
      const result = await this.collection.bulkWrite(operations, {
        ordered: false,
      });
      return {
        inserted: result.upsertedCount,
        matched: result.matchedCount,
        modified: result.modifiedCount,
        failures: [],
      };
    } catch (error) {
      const failures = bulkWriteFailures(error, batch);
      if (failures.length === 0) throw error;
      const counts = (error as { result?: unknown }).result;
      return {
        inserted: count(counts, 'upsertedCount'),
        matched: count(counts, 'matchedCount'),
        modified: count(counts, 'modifiedCount'),
        failures,
      };
    }
  }

  async summarise(): Promise<CollectionSummary> {
    const imported = {
      tenantId: this.tenantId,
      'source.system': SOURCE_SYSTEM,
    };
    const [documents, withLocation] = await Promise.all([
      this.collection.countDocuments(imported),
      this.collection.countDocuments({
        ...imported,
        location: { $exists: true },
      }),
    ]);
    return { documents, withLocation };
  }
}

/**
 * The per-row failures of a bulk write that was only partly refused. The
 * driver's MongoBulkWriteError carries them in writeErrors (one error or a
 * list), each with the index of the operation. Any other error, or one with
 * no row-level failures, gives an empty list so the caller rethrows it.
 */
function bulkWriteFailures(
  error: unknown,
  batch: readonly ImportedRestaurant[],
): WriteFailure[] {
  const writeErrors = read(error, 'writeErrors');
  if (writeErrors === undefined || writeErrors === null) return [];
  const list: unknown[] = Array.isArray(writeErrors)
    ? writeErrors
    : [writeErrors];
  return list.map((entry) => {
    const index = read(entry, 'index');
    const code = read(entry, 'code');
    const message = read(entry, 'errmsg');
    const text = typeof message === 'string' ? message : 'the write failed';
    return {
      sourceId:
        typeof index === 'number'
          ? (batch[index]?.source.id ?? `row ${index}`)
          : 'unknown',
      message: typeof code === 'number' ? `${text} (code ${code})` : text,
    };
  });
}

function read(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function count(result: unknown, key: string): number {
  const value = read(result, key);
  return typeof value === 'number' ? value : 0;
}
