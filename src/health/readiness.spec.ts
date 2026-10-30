import { FakeDb, serverError } from '../../test/support/fake-db';
import {
  RESTAURANT_INDEX_NAMES,
  SEARCH_INDEX_NAME,
} from '../database/restaurants.collection';
import { inspectReadiness } from './readiness';

const allIndexes = ['_id_', ...RESTAURANT_INDEX_NAMES];
const readySearch = [
  { name: SEARCH_INDEX_NAME, status: 'READY', queryable: true },
];

describe('inspectReadiness', () => {
  it('is ready when MongoDB answers and every expected index exists', async () => {
    const fake = new FakeDb({
      indexNames: allIndexes,
      searchIndexes: readySearch,
    });

    const report = await inspectReadiness(fake.asDb());

    expect(report.status).toBe('ready');
    expect(report.mongodb.status).toBe('up');
    expect(typeof report.mongodb.latencyMs).toBe('number');
    expect(report.indexes).toEqual({
      status: 'ok',
      present: allIndexes,
      missing: [],
    });
    expect(report.search).toEqual({
      index: SEARCH_INDEX_NAME,
      status: 'READY',
      queryable: true,
    });
  });

  it('is unavailable, and asks nothing else, when MongoDB does not answer', async () => {
    const fake = new FakeDb({ pingError: new Error('connection refused') });

    const report = await inspectReadiness(fake.asDb());

    expect(report.status).toBe('unavailable');
    expect(report.mongodb).toEqual({
      status: 'down',
      error: 'connection refused',
    });
    expect(report.indexes.status).toBe('unknown');
    expect(report.search.status).toBe('UNKNOWN');
    expect(fake.calls).toEqual(['ping']);
  });

  it('is unavailable and names every index that is missing', async () => {
    const fake = new FakeDb({
      indexNames: ['_id_', RESTAURANT_INDEX_NAMES[0]],
    });

    const report = await inspectReadiness(fake.asDb());

    expect(report.status).toBe('unavailable');
    expect(report.indexes.status).toBe('missing');
    expect(report.indexes.missing).toEqual(RESTAURANT_INDEX_NAMES.slice(1));
  });

  it('treats a collection that does not exist as having every index missing', async () => {
    const fake = new FakeDb({
      listIndexesError: serverError(26, 'ns does not exist'),
    });

    const report = await inspectReadiness(fake.asDb());

    expect(report.status).toBe('unavailable');
    expect(report.indexes.missing).toEqual(RESTAURANT_INDEX_NAMES);
  });

  it('is unavailable when the index list cannot be read for another reason', async () => {
    const fake = new FakeDb({
      listIndexesError: serverError(13, 'not authorized'),
    });

    const report = await inspectReadiness(fake.asDb());

    expect(report.status).toBe('unavailable');
    expect(report.indexes.status).toBe('unknown');
    expect(report.indexes.error).toBe('not authorized');
  });

  it('stays ready when the search index is unavailable', async () => {
    const fake = new FakeDb({
      indexNames: allIndexes,
      searchIndexes: serverError(31082, 'search is not enabled here'),
    });

    const report = await inspectReadiness(fake.asDb());

    expect(report.status).toBe('ready');
    expect(report.search.status).toBe('UNAVAILABLE');
    expect(report.search.queryable).toBe(false);
    expect(report.search.error).toBe('search is not enabled here');
  });

  it('reports a missing search index without failing readiness', async () => {
    const fake = new FakeDb({ indexNames: allIndexes, searchIndexes: [] });

    const report = await inspectReadiness(fake.asDb());

    expect(report.status).toBe('ready');
    expect(report.search.status).toBe('MISSING');
  });

  it('gives up on a check that never answers instead of hanging', async () => {
    const fake = new FakeDb({ pingHangs: true });

    const report = await inspectReadiness(fake.asDb(), 50);

    expect(report.status).toBe('unavailable');
    expect(report.mongodb.status).toBe('down');
    expect(report.mongodb.error).toBe('ping timed out after 50 ms');
  });
});
