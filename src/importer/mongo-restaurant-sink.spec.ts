import type { AnyBulkWriteOperation, Collection, Document } from 'mongodb';
import { containsUndefined } from '../../test/support/json-schema-lite';
import { zomatoRow } from '../../test/support/zomato-rows';
import { cleanRow } from './clean-row';
import type { ImportedRestaurant } from './imported-restaurant';
import { MongoRestaurantSink, toUpsert } from './mongo-restaurant-sink';
import type { ZomatoRow } from './zomato-csv';

const NOW = new Date('2026-10-30T12:00:00.000Z');

function restaurant(overrides: Partial<ZomatoRow> = {}): ImportedRestaurant {
  const result = cleanRow(zomatoRow(overrides), new Map());
  if (!result.ok) throw new Error(result.reason);
  return result.restaurant;
}

/** The parts of an updateOne operation a test wants to look at. */
function updateOf(operation: AnyBulkWriteOperation<Document>) {
  if (!('updateOne' in operation)) throw new Error('expected an updateOne');
  const { filter, update, upsert } = operation.updateOne;
  return { filter, update: update as Document, upsert };
}

describe('toUpsert', () => {
  it('finds the restaurant by tenant, source system and source id, and creates it if absent', () => {
    const { filter, upsert } = updateOf(toUpsert(restaurant(), 'acme', NOW));

    expect(filter).toEqual({
      tenantId: 'acme',
      'source.system': 'zomato',
      'source.id': '308022',
    });
    expect(upsert).toBe(true);
  });

  it('sets every field the importer owns, plus updatedAt', () => {
    const doc = restaurant();
    const { update } = updateOf(toUpsert(doc, 'acme', NOW));

    expect(update.$set).toEqual({
      schemaVersion: 1,
      name: 'Farzi Cafe',
      address: doc.address,
      location: doc.location,
      cuisines: doc.cuisines,
      cost: doc.cost,
      rating: doc.rating,
      services: doc.services,
      status: 'active',
      dataQuality: [],
      updatedAt: NOW,
    });
  });

  it('leaves the identity out of $set: it comes from the filter when the document is created', () => {
    const { update } = updateOf(toUpsert(restaurant(), 'acme', NOW));

    expect('tenantId' in update.$set).toBe(false);
    expect('source' in update.$set).toBe(false);
  });

  it('sets createdAt only when the document is created', () => {
    const { update } = updateOf(toUpsert(restaurant(), 'acme', NOW));

    expect(update.$setOnInsert).toEqual({ createdAt: NOW });
    expect('createdAt' in update.$set).toBe(false);
  });

  it('does not remove the location of a restaurant that has one', () => {
    const { update } = updateOf(toUpsert(restaurant(), 'acme', NOW));

    expect(update.$unset).toBeUndefined();
  });

  it('removes a stored location when the restaurant has none now', () => {
    const { update } = updateOf(
      toUpsert(restaurant({ Latitude: '0', Longitude: '0' }), 'acme', NOW),
    );

    expect('location' in update.$set).toBe(false);
    expect(update.$unset).toEqual({ location: '' });
  });

  it('never puts an undefined value in the update, which the driver would store as null', () => {
    for (const doc of [
      restaurant(),
      restaurant({ Latitude: '0', Longitude: '0', Address: '', Locality: '' }),
    ]) {
      expect(
        containsUndefined(updateOf(toUpsert(doc, 'acme', NOW)).update),
      ).toBe(false);
    }
  });

  it('does not change the restaurant it is given', () => {
    const doc = restaurant();
    const before = JSON.stringify(doc);

    toUpsert(doc, 'acme', NOW);

    expect(JSON.stringify(doc)).toBe(before);
  });
});

interface FakeCollectionOptions {
  bulkWrite?: (
    operations: AnyBulkWriteOperation<Document>[],
    options: unknown,
  ) => Promise<unknown>;
  counts?: number[];
}

/** Records what the sink asks of the collection. */
function fakeCollection(options: FakeCollectionOptions = {}) {
  const bulkWrites: Array<{
    operations: AnyBulkWriteOperation<Document>[];
    options: unknown;
  }> = [];
  const countFilters: Document[] = [];
  const counts = [...(options.counts ?? [0, 0])];
  const collection = {
    bulkWrite: async (
      operations: AnyBulkWriteOperation<Document>[],
      bulkOptions: unknown,
    ) => {
      bulkWrites.push({ operations, options: bulkOptions });
      if (options.bulkWrite) return options.bulkWrite(operations, bulkOptions);
      return {
        upsertedCount: operations.length,
        matchedCount: 0,
        modifiedCount: 0,
      };
    },
    countDocuments: async (filter: Document) => {
      countFilters.push(filter);
      return counts.shift() ?? 0;
    },
  };
  return {
    collection: collection as unknown as Collection<Document>,
    bulkWrites,
    countFilters,
  };
}

/** The error the driver throws when some operations of an unordered bulk write fail. */
function bulkWriteError(
  writeErrors: unknown,
  result: Record<string, number> = {},
): Error {
  return Object.assign(new Error('bulk write failed'), { writeErrors, result });
}

describe('MongoRestaurantSink.upsertBatch', () => {
  const batch = [
    restaurant({ 'Restaurant ID': '1' }),
    restaurant({ 'Restaurant ID': '2' }),
    restaurant({ 'Restaurant ID': '3' }),
  ];

  it('sends the whole batch in one unordered bulk write', async () => {
    const { collection, bulkWrites } = fakeCollection();

    await new MongoRestaurantSink(collection, 'acme', NOW).upsertBatch(batch);

    expect(bulkWrites).toHaveLength(1);
    expect(bulkWrites[0].operations).toHaveLength(3);
    expect(bulkWrites[0].options).toEqual({ ordered: false });
  });

  it('writes under the tenant and with one timestamp for the whole run', async () => {
    const { collection, bulkWrites } = fakeCollection();

    await new MongoRestaurantSink(collection, 'acme', NOW).upsertBatch(batch);

    for (const operation of bulkWrites[0].operations) {
      const { filter, update } = updateOf(operation);
      expect(filter.tenantId).toBe('acme');
      expect(update.$set.updatedAt).toBe(NOW);
      expect(update.$setOnInsert.createdAt).toBe(NOW);
    }
  });

  it('reports what the database did', async () => {
    const { collection } = fakeCollection({
      bulkWrite: async () => ({
        upsertedCount: 1,
        matchedCount: 2,
        modifiedCount: 2,
      }),
    });

    const outcome = await new MongoRestaurantSink(
      collection,
      'acme',
      NOW,
    ).upsertBatch(batch);

    expect(outcome).toEqual({
      inserted: 1,
      matched: 2,
      modified: 2,
      failures: [],
    });
  });

  it('does not call the database for an empty batch', async () => {
    const { collection, bulkWrites } = fakeCollection();

    const outcome = await new MongoRestaurantSink(
      collection,
      'acme',
      NOW,
    ).upsertBatch([]);

    expect(bulkWrites).toHaveLength(0);
    expect(outcome).toEqual({
      inserted: 0,
      matched: 0,
      modified: 0,
      failures: [],
    });
  });

  it('reports the rows the database refused and counts the ones it wrote', async () => {
    const { collection } = fakeCollection({
      bulkWrite: async () => {
        throw bulkWriteError(
          [
            { index: 1, code: 121, errmsg: 'Document failed validation' },
            { index: 2, code: 11000, errmsg: 'E11000 duplicate key' },
          ],
          { upsertedCount: 1, matchedCount: 0, modifiedCount: 0 },
        );
      },
    });

    const outcome = await new MongoRestaurantSink(
      collection,
      'acme',
      NOW,
    ).upsertBatch(batch);

    expect(outcome.inserted).toBe(1);
    expect(outcome.failures).toEqual([
      { sourceId: '2', message: 'Document failed validation (code 121)' },
      { sourceId: '3', message: 'E11000 duplicate key (code 11000)' },
    ]);
  });

  it('understands the driver reporting a single refused row as one error, not a list', async () => {
    const { collection } = fakeCollection({
      bulkWrite: async () => {
        throw bulkWriteError(
          { index: 0, code: 121, errmsg: 'Document failed validation' },
          {
            upsertedCount: 2,
          },
        );
      },
    });

    const outcome = await new MongoRestaurantSink(
      collection,
      'acme',
      NOW,
    ).upsertBatch(batch);

    expect(outcome.inserted).toBe(2);
    expect(outcome.failures).toEqual([
      { sourceId: '1', message: 'Document failed validation (code 121)' },
    ]);
  });

  it('still names a refused row when the error has no message or code', async () => {
    const { collection } = fakeCollection({
      bulkWrite: async () => {
        throw bulkWriteError([{ index: 7 }]);
      },
    });

    const outcome = await new MongoRestaurantSink(
      collection,
      'acme',
      NOW,
    ).upsertBatch(batch);

    expect(outcome.failures).toEqual([
      { sourceId: 'row 7', message: 'the write failed' },
    ]);
  });

  it('rethrows an error that is not about individual rows, such as a lost connection', async () => {
    const networkError = new Error('connection closed');
    const { collection } = fakeCollection({
      bulkWrite: async () => {
        throw networkError;
      },
    });

    await expect(
      new MongoRestaurantSink(collection, 'acme', NOW).upsertBatch(batch),
    ).rejects.toThrow('connection closed');
  });

  it('rethrows a bulk error that lists no rows rather than pretending all went well', async () => {
    const { collection } = fakeCollection({
      bulkWrite: async () => {
        throw bulkWriteError([]);
      },
    });

    await expect(
      new MongoRestaurantSink(collection, 'acme', NOW).upsertBatch(batch),
    ).rejects.toThrow('bulk write failed');
  });
});

describe('MongoRestaurantSink.summarise', () => {
  it("counts the tenant's imported documents and those with a location", async () => {
    const { collection, countFilters } = fakeCollection({ counts: [500, 439] });

    const summary = await new MongoRestaurantSink(
      collection,
      'acme',
      NOW,
    ).summarise();

    expect(summary).toEqual({ documents: 500, withLocation: 439 });
    expect(countFilters).toEqual([
      { tenantId: 'acme', 'source.system': 'zomato' },
      {
        tenantId: 'acme',
        'source.system': 'zomato',
        location: { $exists: true },
      },
    ]);
  });
});
