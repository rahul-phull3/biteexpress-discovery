import { Logger } from '@nestjs/common';
import { type Db, ObjectId } from 'mongodb';
import { SEARCH_INDEX_NAME } from '../database/restaurants.collection';
import {
  AtlasTextSearch,
  createTextSearch,
  NOT_READY_VERDICT_MS,
  READY_VERDICT_MS,
} from './atlas-text-search';
import { RulesTextSearch } from './text-search';

// AtlasTextSearch against a stand-in database: what it asks, when it asks, and
// that every way of not getting an answer ends as null (the plain rules).
// test/atlas-text-search.int-spec.ts runs it against a real Atlas Search.

const LIMIT = 1500;
const A = 'a'.repeat(24);
const B = 'b'.repeat(24);

const READY = [{ name: SEARCH_INDEX_NAME, status: 'READY', queryable: true }];
const BUILDING = [{ name: SEARCH_INDEX_NAME, status: 'BUILDING', queryable: false }];

interface Script {
  /** What listSearchIndexes answers, or the error it throws. */
  indexes: Array<{ name: string; status?: string; queryable?: boolean }> | Error;
  /** What $search answers, or the error it throws. */
  rows: Array<{ _id: ObjectId }> | Error;
}

function fakeDb(script: Script) {
  const seen = { indexChecks: 0, searches: [] as Array<{ pipeline: any[]; options: unknown }> };
  const collection = {
    listSearchIndexes: () => {
      seen.indexChecks += 1;
      return {
        toArray: async () => {
          if (script.indexes instanceof Error) throw script.indexes;
          return script.indexes;
        },
      };
    },
    aggregate: (pipeline: any[], options: unknown) => {
      seen.searches.push({ pipeline, options });
      return {
        toArray: async () => {
          if (script.rows instanceof Error) throw script.rows;
          return script.rows;
        },
      };
    },
  };
  return { db: { collection: () => collection } as unknown as Db, seen, script };
}

describe('AtlasTextSearch', () => {
  let clock: number;
  const now = () => clock;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    clock = 1_000_000;
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  const searchOn = (script: Script) => {
    const fake = fakeDb(script);
    return { ...fake, search: new AtlasTextSearch(fake.db, LIMIT, now) };
  };

  it('names the restaurants that Atlas Search found, best match first, as ids', async () => {
    const { search } = searchOn({ indexes: READY, rows: [{ _id: new ObjectId(B) }, { _id: new ObjectId(A) }] });

    expect(await search.candidates('t1', ['vada', 'pav'])).toEqual([B, A]);
  });

  it('asks the restaurants_search index for the tenant and the words, within the time limit', async () => {
    const { search, seen } = searchOn({ indexes: READY, rows: [] });

    await search.candidates('t1', ['vada', 'pav']);

    expect(seen.searches).toHaveLength(1);
    expect(seen.searches[0]?.options).toEqual({ maxTimeMS: LIMIT });
    const stage = seen.searches[0]?.pipeline[0].$search;
    expect(stage.index).toBe(SEARCH_INDEX_NAME);
    expect(stage.compound.filter[0]).toEqual({ equals: { path: 'tenantId', value: 't1' } });
    expect(stage.compound.must).toHaveLength(2);
  });

  it('names nobody, which is an answer, when nothing fits the words', async () => {
    const { search } = searchOn({ indexes: READY, rows: [] });

    expect(await search.candidates('t1', ['zzzz'])).toEqual([]);
  });

  it('cannot answer while the index is not ready, and does not search it', async () => {
    const { search, seen } = searchOn({ indexes: BUILDING, rows: [{ _id: new ObjectId(A) }] });

    expect(await search.candidates('t1', ['vada'])).toBeNull();
    expect(seen.searches).toHaveLength(0);
  });

  it('cannot answer when there is no Atlas Search index at all', async () => {
    const { search, seen } = searchOn({ indexes: [], rows: [{ _id: new ObjectId(A) }] });

    expect(await search.candidates('t1', ['vada'])).toBeNull();
    expect(seen.searches).toHaveLength(0);
  });

  it('cannot answer when the database has no Atlas Search', async () => {
    const notEnabled = Object.assign(new Error('search is not enabled here'), { code: 31082 });
    const { search, seen } = searchOn({ indexes: notEnabled, rows: [] });

    expect(await search.candidates('t1', ['vada'])).toBeNull();
    expect(seen.searches).toHaveLength(0);
  });

  it('cannot answer, and logs why, when the search itself fails', async () => {
    const { search } = searchOn({ indexes: READY, rows: new Error('mongot restarted') });

    expect(await search.candidates('t1', ['vada'])).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('mongot restarted');
  });

  it('looks at the index only once while its verdict is fresh', async () => {
    const { search, seen } = searchOn({ indexes: READY, rows: [] });

    await search.candidates('t1', ['vada']);
    await search.candidates('t1', ['pav']);
    expect(seen.indexChecks).toBe(1);

    clock += READY_VERDICT_MS;
    await search.candidates('t1', ['pav']);
    expect(seen.indexChecks).toBe(2);
  });

  it('looks again after a few seconds when the index was not ready, so a finished build is noticed', async () => {
    const { search, seen, script } = searchOn({ indexes: BUILDING, rows: [{ _id: new ObjectId(A) }] });
    expect(await search.candidates('t1', ['vada'])).toBeNull();

    script.indexes = READY;
    clock += NOT_READY_VERDICT_MS - 1;
    expect(await search.candidates('t1', ['vada'])).toBeNull();
    expect(seen.indexChecks).toBe(1);

    clock += 1;
    expect(await search.candidates('t1', ['vada'])).toEqual([A]);
    expect(seen.indexChecks).toBe(2);
  });

  it('looks at the index again after a search failed', async () => {
    const { search, seen, script } = searchOn({ indexes: READY, rows: new Error('boom') });
    expect(await search.candidates('t1', ['vada'])).toBeNull();

    script.rows = [{ _id: new ObjectId(A) }];

    expect(await search.candidates('t1', ['vada'])).toEqual([A]);
    expect(seen.indexChecks).toBe(2);
  });

  it('shares one check of the index between searches that arrive together', async () => {
    const { search, seen } = searchOn({ indexes: READY, rows: [] });

    await Promise.all([search.candidates('t1', ['a']), search.candidates('t1', ['b']), search.candidates('t1', ['c'])]);

    expect(seen.indexChecks).toBe(1);
    expect(seen.searches).toHaveLength(3);
  });
});

describe('createTextSearch', () => {
  const { db } = fakeDb({ indexes: READY, rows: [] });

  it('builds the Atlas Search engine when the setting says atlas', () => {
    const engine = createTextSearch(db, { engine: 'atlas', timeoutMs: LIMIT });

    expect(engine).toBeInstanceOf(AtlasTextSearch);
    expect(engine.engine).toBe('atlas');
  });

  it('builds the plain rules when the setting says rules', async () => {
    const engine = createTextSearch(db, { engine: 'rules', timeoutMs: LIMIT });

    expect(engine).toBeInstanceOf(RulesTextSearch);
    expect(engine.engine).toBe('rules');
    expect(await engine.candidates('t1', ['vada'])).toBeNull();
  });
});
