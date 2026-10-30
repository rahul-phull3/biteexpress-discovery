import { FakeDb, serverError } from '../../test/support/fake-db';
import {
  RESTAURANT_INDEXES,
  RESTAURANTS_COLLECTION,
  restaurantValidator,
  SEARCH_INDEX_NAME,
} from './restaurants.collection';
import { ensureRestaurantsSchema } from './schema-bootstrap';

function recorder() {
  const lines: string[] = [];
  return {
    lines,
    logger: {
      log: (message: string) => {
        lines.push(`log: ${message}`);
      },
      warn: (message: string) => {
        lines.push(`warn: ${message}`);
      },
    },
  };
}

const indexCall = `createIndexes:${RESTAURANTS_COLLECTION}:${RESTAURANT_INDEXES.length}`;
const listSearch = `listSearchIndexes:${SEARCH_INDEX_NAME}`;
const createSearch = `createSearchIndex:${SEARCH_INDEX_NAME}`;

describe('ensureRestaurantsSchema', () => {
  it('on a new database creates the collection with its validator, then the indexes, then the search index', async () => {
    const fake = new FakeDb();

    await ensureRestaurantsSchema(fake.asDb(), recorder().logger);

    expect(fake.calls).toEqual([
      'listCollections',
      `createCollection:${RESTAURANTS_COLLECTION}`,
      indexCall,
      listSearch,
      createSearch,
    ]);
    expect(fake.createCollectionArgs[0].options).toEqual({
      validator: restaurantValidator,
      validationLevel: 'strict',
      validationAction: 'error',
    });
  });

  it('updates the validator in place when the collection already exists', async () => {
    const fake = new FakeDb({ collections: [RESTAURANTS_COLLECTION] });

    await ensureRestaurantsSchema(fake.asDb(), recorder().logger);

    expect(fake.calls).toEqual([
      'listCollections',
      `collMod:${RESTAURANTS_COLLECTION}`,
      indexCall,
      listSearch,
      createSearch,
    ]);
    expect(fake.collModArgs[0]).toEqual({
      collMod: RESTAURANTS_COLLECTION,
      validator: restaurantValidator,
      validationLevel: 'strict',
      validationAction: 'error',
    });
  });

  it('falls back to updating when another instance creates the collection first', async () => {
    const fake = new FakeDb({
      createCollectionError: serverError(48, 'Collection already exists'),
    });

    await ensureRestaurantsSchema(fake.asDb(), recorder().logger);

    expect(fake.calls).toContain(`createCollection:${RESTAURANTS_COLLECTION}`);
    expect(fake.calls).toContain(`collMod:${RESTAURANTS_COLLECTION}`);
  });

  it('does not hide other errors from createCollection', async () => {
    const fake = new FakeDb({
      createCollectionError: serverError(13, 'not authorized'),
    });

    await expect(
      ensureRestaurantsSchema(fake.asDb(), recorder().logger),
    ).rejects.toThrow('not authorized');
  });

  it('leaves an existing search index alone', async () => {
    const fake = new FakeDb({
      collections: [RESTAURANTS_COLLECTION],
      searchIndexes: [{ name: SEARCH_INDEX_NAME, status: 'READY' }],
    });
    const { logger, lines } = recorder();

    await ensureRestaurantsSchema(fake.asDb(), logger);

    expect(fake.calls).not.toContain(createSearch);
    expect(
      lines.some((line) => line.includes('already exists (status: READY)')),
    ).toBe(true);
  });

  it('keeps starting, and says why, when the deployment has no search process', async () => {
    const fake = new FakeDb({
      searchIndexes: serverError(31082, 'search commands need Atlas'),
    });
    const { logger, lines } = recorder();

    await ensureRestaurantsSchema(fake.asDb(), logger);

    expect(fake.calls).not.toContain(createSearch);
    expect(
      lines.some(
        (line) =>
          line.startsWith('warn:') &&
          line.includes('search commands need Atlas'),
      ),
    ).toBe(true);
  });

  it('keeps starting when creating the search index fails', async () => {
    const fake = new FakeDb({
      createSearchIndexError: new Error('invalid index definition'),
    });
    const { logger, lines } = recorder();

    await ensureRestaurantsSchema(fake.asDb(), logger);

    expect(lines.some((line) => line.startsWith('warn:'))).toBe(true);
  });

  it('explains what to do when an index exists with a different definition', async () => {
    const fake = new FakeDb({
      createIndexesError: serverError(
        85,
        'Index already exists with different options',
      ),
    });

    await expect(
      ensureRestaurantsSchema(fake.asDb(), recorder().logger),
    ).rejects.toThrow('npm run db:reset');
  });

  it('rethrows other index errors unchanged', async () => {
    const fake = new FakeDb({ createIndexesError: new Error('disk full') });

    await expect(
      ensureRestaurantsSchema(fake.asDb(), recorder().logger),
    ).rejects.toThrow('disk full');
  });
});
