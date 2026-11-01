import type { Db } from 'mongodb';
import { QueryTimeoutError } from '../database/query-timeout.error';
import { DEFAULT_READ_TIMEOUT_MS } from '../database/read-limits';
import type { ListCriteria } from './list-criteria';
import { MongoRestaurantStore } from './mongo-restaurant.store';

// The MongoDB store sends a time limit with every read, and turns MongoDB's
// "ran past its limit" error into a QueryTimeoutError. Neither needs a real
// database: a stand-in collection records what it was asked and fails on
// demand. What the queries return is checked against a real MongoDB in
// test/restaurants.int-spec.ts.

interface Read {
  method: 'findOne' | 'find' | 'aggregate';
  /** The options that the read was sent with: where maxTimeMS goes. */
  options: Record<string, unknown> | undefined;
}

function recordingDb(failure?: unknown) {
  const reads: Read[] = [];
  const answer = async (): Promise<unknown[]> => {
    if (failure !== undefined) throw failure;
    return [];
  };
  const collection = {
    findOne: async (...args: unknown[]) => {
      reads.push({ method: 'findOne', options: args[1] as Read['options'] });
      if (failure !== undefined) throw failure;
      return null;
    },
    find: (...args: unknown[]) => {
      reads.push({ method: 'find', options: args[1] as Read['options'] });
      const cursor = {
        sort: () => cursor,
        skip: () => cursor,
        limit: () => cursor,
        toArray: answer,
      };
      return cursor;
    },
    aggregate: (...args: unknown[]) => {
      reads.push({ method: 'aggregate', options: args[1] as Read['options'] });
      return { toArray: answer };
    },
  };
  return { db: { collection: () => collection } as unknown as Db, reads };
}

const LIMIT = 1500;
const ID = 'a'.repeat(24);

const plain: ListCriteria = { cuisineMatch: 'any', sort: 'rating', order: 'desc', limit: 20, offset: 0 };
const nearby: ListCriteria = {
  ...plain,
  sort: 'distance',
  order: 'asc',
  near: { latitude: 28.495, longitude: 77.089 },
};

const readsOfTheStore: Array<{ name: string; read: (store: MongoRestaurantStore) => Promise<unknown> }> = [
  { name: 'a lookup by id', read: (store) => store.findById('t', ID) },
  { name: 'a listing without a point', read: (store) => store.list('t', plain) },
  { name: 'a listing nearest first', read: (store) => store.list('t', nearby) },
  { name: 'the vocabulary', read: (store) => store.vocabulary('t') },
];

describe('MongoRestaurantStore time limit', () => {
  it('sends the limit with a lookup by id', async () => {
    const { db, reads } = recordingDb();

    await new MongoRestaurantStore(db, LIMIT).findById('t', ID);

    expect(reads).toEqual([{ method: 'findOne', options: { maxTimeMS: LIMIT } }]);
  });

  it('sends the limit with a listing without a point', async () => {
    const { db, reads } = recordingDb();

    await new MongoRestaurantStore(db, LIMIT).list('t', plain);

    expect(reads).toHaveLength(1);
    expect(reads[0]).toMatchObject({ method: 'find', options: { maxTimeMS: LIMIT } });
  });

  it('sends the limit with a listing nearest first', async () => {
    const { db, reads } = recordingDb();

    await new MongoRestaurantStore(db, LIMIT).list('t', nearby);

    expect(reads).toEqual([{ method: 'aggregate', options: { maxTimeMS: LIMIT } }]);
  });

  it('sends the limit with both queries of the vocabulary', async () => {
    const { db, reads } = recordingDb();

    await new MongoRestaurantStore(db, LIMIT).vocabulary('t');

    expect(reads).toEqual([
      { method: 'aggregate', options: { maxTimeMS: LIMIT } },
      { method: 'aggregate', options: { maxTimeMS: LIMIT } },
    ]);
  });

  it('uses the default limit when none is given', async () => {
    const { db, reads } = recordingDb();

    await new MongoRestaurantStore(db).findById('t', ID);

    expect(reads[0]?.options).toEqual({ maxTimeMS: DEFAULT_READ_TIMEOUT_MS });
  });

  describe.each(readsOfTheStore)('when $name runs past the limit', ({ read }) => {
    it('fails with a QueryTimeoutError that names the limit and keeps the original error', async () => {
      // 50 is MongoDB's code for "operation exceeded time limit".
      const original = Object.assign(new Error('operation exceeded time limit'), { code: 50 });
      const { db } = recordingDb(original);

      const failure = await read(new MongoRestaurantStore(db, LIMIT)).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(QueryTimeoutError);
      expect((failure as QueryTimeoutError).limitMs).toBe(LIMIT);
      expect((failure as QueryTimeoutError).cause).toBe(original);
    });

    it('lets any other error through unchanged', async () => {
      const original = Object.assign(new Error('not primary'), { code: 10107 });
      const { db } = recordingDb(original);

      const failure = await read(new MongoRestaurantStore(db, LIMIT)).catch((error: unknown) => error);

      expect(failure).toBe(original);
    });
  });
});
