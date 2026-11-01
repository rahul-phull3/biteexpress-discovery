import { VocabularyCache, VOCABULARY_TTL_MS } from './vocabulary-cache';
import type { VocabularyData } from './vocabulary';

const data = (city: string): VocabularyData => ({ cities: [{ name: city, count: 1 }], cuisines: [] });

function setup(ttlMs = 1000) {
  let now = 0;
  const loads: string[] = [];
  const load = async (tenantId: string): Promise<VocabularyData> => {
    loads.push(tenantId);
    return data(`City of ${tenantId} #${loads.length}`);
  };
  const cache = new VocabularyCache(load, ttlMs, () => now);
  return { cache, loads, advance: (ms: number) => void (now += ms) };
}

describe('VocabularyCache', () => {
  it('asks the database once for requests that arrive together', async () => {
    const { cache, loads } = setup();

    const [first, second] = await Promise.all([cache.get('t1'), cache.get('t1')]);

    expect(loads).toEqual(['t1']);
    expect(second).toBe(first);
  });

  it('reuses the vocabulary until the time to live has passed', async () => {
    const { cache, loads, advance } = setup(1000);
    const first = await cache.get('t1');

    advance(999);
    expect(await cache.get('t1')).toBe(first);
    expect(loads).toHaveLength(1);

    advance(1);
    const second = await cache.get('t1');
    expect(second).not.toBe(first);
    expect(loads).toHaveLength(2);
  });

  it('keeps a vocabulary per tenant', async () => {
    const { cache, loads } = setup();

    const a = await cache.get('t1');
    const b = await cache.get('t2');

    expect(a.data.cities[0]?.name).toContain('t1');
    expect(b.data.cities[0]?.name).toContain('t2');
    expect(loads).toEqual(['t1', 't2']);
  });

  it('does not remember a failed load: the next request tries again', async () => {
    let failing = true;
    const loads: number[] = [];
    const cache = new VocabularyCache(async () => {
      loads.push(loads.length);
      if (failing) throw new Error('connection reset');
      return data('Gurgaon');
    });

    await expect(cache.get('t1')).rejects.toThrow('connection reset');
    failing = false;

    expect((await cache.get('t1')).data.cities).toEqual([{ name: 'Gurgaon', count: 1 }]);
    expect(loads).toHaveLength(2);
  });

  it('loads again after invalidate', async () => {
    const { cache, loads } = setup();
    const first = await cache.get('t1');

    cache.invalidate('t1');
    const second = await cache.get('t1');

    expect(second).not.toBe(first);
    expect(loads).toHaveLength(2);
  });

  it('invalidates only the tenant it is told to', async () => {
    const { cache, loads } = setup();
    await cache.get('t1');
    const other = await cache.get('t2');

    cache.invalidate('t1');

    expect(await cache.get('t2')).toBe(other);
    expect(loads).toEqual(['t1', 't2']);
  });

  it('lets a late failure of an old load leave the newer vocabulary alone', async () => {
    let rejectFirst: (error: Error) => void = () => undefined;
    let calls = 0;
    const cache = new VocabularyCache(() => {
      calls += 1;
      return calls === 1
        ? new Promise<VocabularyData>((_resolve, reject) => void (rejectFirst = reject))
        : Promise.resolve(data('Gurgaon'));
    });

    const old = cache.get('t1');
    const oldOutcome = old.catch(() => 'failed');
    cache.invalidate('t1');
    const fresh = await cache.get('t1');
    rejectFirst(new Error('late failure'));
    await oldOutcome;

    expect(await cache.get('t1')).toBe(fresh);
    expect(calls).toBe(2);
  });

  it('keeps a vocabulary for a minute by default', () => {
    expect(VOCABULARY_TTL_MS).toBe(60_000);
  });
});
