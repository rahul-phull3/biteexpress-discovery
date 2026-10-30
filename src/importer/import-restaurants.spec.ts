import { zomatoRow } from '../../test/support/zomato-rows';
import { importRestaurants } from './import-restaurants';
import type { ImportedRestaurant } from './imported-restaurant';
import type {
  BatchOutcome,
  CollectionSummary,
  RestaurantSink,
  WriteFailure,
} from './restaurant-sink';
import type { ZomatoRow } from './zomato-csv';

const noFixes = new Map();

/** Rows with ids 1..count, all valid. */
function rows(count: number, overrides: Partial<ZomatoRow> = {}): ZomatoRow[] {
  return Array.from({ length: count }, (_, index) =>
    zomatoRow({ 'Restaurant ID': String(index + 1), ...overrides }),
  );
}

/**
 * A database in memory with the one behaviour that matters here: an upsert
 * keyed by source id. It keeps the order of calls, so tests can see how the
 * work was split into batches.
 */
class MemorySink implements RestaurantSink {
  readonly stored = new Map<string, ImportedRestaurant>();
  readonly batchSizes: number[] = [];
  summarised = 0;

  constructor(private readonly refuse: ReadonlySet<string> = new Set()) {}

  async upsertBatch(
    batch: readonly ImportedRestaurant[],
  ): Promise<BatchOutcome> {
    this.batchSizes.push(batch.length);
    let inserted = 0;
    let matched = 0;
    const failures: WriteFailure[] = [];
    for (const restaurant of batch) {
      const id = restaurant.source.id;
      if (this.refuse.has(id)) {
        failures.push({ sourceId: id, message: 'refused' });
        continue;
      }
      if (this.stored.has(id)) matched += 1;
      else inserted += 1;
      this.stored.set(id, restaurant);
    }
    return { inserted, matched, modified: matched, failures };
  }

  async summarise(): Promise<CollectionSummary> {
    this.summarised += 1;
    const documents = [...this.stored.values()];
    return {
      documents: documents.length,
      withLocation: documents.filter((d) => d.location).length,
    };
  }
}

describe('importRestaurants', () => {
  it('without a sink only cleans and counts: a dry run', async () => {
    const outcome = await importRestaurants(rows(5), noFixes, { batchSize: 2 });

    expect(outcome.stats.rowsRead).toBe(5);
    expect(outcome.stats.rowsAccepted).toBe(5);
    expect(outcome.rejected).toEqual([]);
    expect(outcome.writes).toBeUndefined();
    expect(outcome.collection).toBeUndefined();
  });

  it('writes the accepted rows in batches of the given size', async () => {
    const sink = new MemorySink();

    await importRestaurants(rows(5), noFixes, { batchSize: 2 }, sink);

    expect(sink.batchSizes).toEqual([2, 2, 1]);
    expect(sink.stored.size).toBe(5);
  });

  it('writes one batch when everything fits', async () => {
    const sink = new MemorySink();

    await importRestaurants(rows(5), noFixes, { batchSize: 1000 }, sink);

    expect(sink.batchSizes).toEqual([5]);
  });

  it('adds up the results of all batches', async () => {
    const sink = new MemorySink(new Set(['2', '5']));

    const outcome = await importRestaurants(
      rows(5),
      noFixes,
      { batchSize: 2 },
      sink,
    );

    expect(outcome.writes).toEqual({
      inserted: 3,
      matched: 0,
      modified: 0,
      failures: [
        { sourceId: '2', message: 'refused' },
        { sourceId: '5', message: 'refused' },
      ],
    });
  });

  it('looks at the collection once, after the last batch', async () => {
    const sink = new MemorySink();

    const outcome = await importRestaurants(
      rows(5),
      noFixes,
      { batchSize: 2 },
      sink,
    );

    expect(sink.summarised).toBe(1);
    expect(outcome.collection).toEqual({ documents: 5, withLocation: 5 });
  });

  it('leaves a rejected row out, lists it, and still imports the others', async () => {
    const data = rows(3);
    data[1] = zomatoRow({ 'Restaurant ID': '2', 'Country Code': '999' });
    const sink = new MemorySink();

    const outcome = await importRestaurants(
      data,
      noFixes,
      { batchSize: 10 },
      sink,
    );

    expect(outcome.rejected).toEqual([
      { sourceId: '2', reason: 'unknown Country Code "999"' },
    ]);
    expect(outcome.stats.rowsRead).toBe(3);
    expect(outcome.stats.rowsAccepted).toBe(2);
    expect(outcome.stats.rowsRejected).toBe(1);
    expect([...sink.stored.keys()]).toEqual(['1', '3']);
  });

  it('rejects a repeated restaurant id instead of writing it twice', async () => {
    const data = [
      zomatoRow({ 'Restaurant ID': '7', 'Restaurant Name': 'First' }),
      zomatoRow({ 'Restaurant ID': '7', 'Restaurant Name': 'Second' }),
    ];
    const sink = new MemorySink();

    const outcome = await importRestaurants(
      data,
      noFixes,
      { batchSize: 10 },
      sink,
    );

    expect(outcome.rejected).toEqual([
      { sourceId: '7', reason: 'duplicate Restaurant ID in the file' },
    ]);
    expect(sink.stored.get('7')?.name).toBe('First');
  });

  it('treats ids that differ only in spaces as the same restaurant', async () => {
    const data = [
      zomatoRow({ 'Restaurant ID': '7' }),
      zomatoRow({ 'Restaurant ID': ' 7 ' }),
    ];

    const outcome = await importRestaurants(data, noFixes, { batchSize: 10 });

    expect(outcome.stats.rowsAccepted).toBe(1);
    expect(outcome.rejected).toHaveLength(1);
  });

  it('is repeatable: the second run inserts nothing and leaves the same documents', async () => {
    const sink = new MemorySink();
    const data = rows(5);

    const first = await importRestaurants(
      data,
      noFixes,
      { batchSize: 2 },
      sink,
    );
    const afterFirst = JSON.stringify([...sink.stored.entries()]);
    const second = await importRestaurants(
      data,
      noFixes,
      { batchSize: 2 },
      sink,
    );

    expect(first.writes).toMatchObject({ inserted: 5, matched: 0 });
    expect(second.writes).toMatchObject({ inserted: 0, matched: 5 });
    expect(second.collection).toEqual({ documents: 5, withLocation: 5 });
    expect(JSON.stringify([...sink.stored.entries()])).toBe(afterFirst);
  });

  it('applies the text fixes it is given', async () => {
    const sink = new MemorySink();
    const fixes = new Map([['1', { name: 'Café' }]]);

    const outcome = await importRestaurants(
      rows(1),
      fixes,
      { batchSize: 10 },
      sink,
    );

    expect(sink.stored.get('1')?.name).toBe('Café');
    expect(outcome.stats.textRepaired).toBe(1);
  });

  it('copes with no rows at all', async () => {
    const sink = new MemorySink();

    const outcome = await importRestaurants(
      [],
      noFixes,
      { batchSize: 10 },
      sink,
    );

    expect(sink.batchSizes).toEqual([]);
    expect(outcome.stats.rowsRead).toBe(0);
    expect(outcome.collection).toEqual({ documents: 0, withLocation: 0 });
  });

  it('refuses a batch size that is not a whole number of at least 1', async () => {
    for (const batchSize of [
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      await expect(
        importRestaurants(rows(1), noFixes, { batchSize }),
      ).rejects.toThrow('batchSize must be a whole number of at least 1');
    }
  });

  it('stops and passes the error on when the sink fails outright', async () => {
    const sink = new MemorySink();
    sink.upsertBatch = async () => {
      throw new Error('connection closed');
    };

    await expect(
      importRestaurants(rows(3), noFixes, { batchSize: 2 }, sink),
    ).rejects.toThrow('connection closed');
  });
});
