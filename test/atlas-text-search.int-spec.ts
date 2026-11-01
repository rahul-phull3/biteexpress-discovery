// Integration test of Atlas Search: this talks to a REAL MongoDB with its search
// process (the Atlas Local container). Start it with `npm run db:up`, then run
// `npm run test:int`.
//
// What no unit test can show: that the $search query is accepted by a real
// mongot, that it fits the index that schema-bootstrap creates, and that whole
// words, the start of a word, one typo and the area of a restaurant are found,
// while another tenant's and an inactive restaurant never are.
//
// Atlas Search indexes in the background. The index needs a moment before it
// can be queried, and a restaurant needs a moment before it can be found, so
// this file waits for both (it polls, up to 45 seconds) instead of sleeping.
import { MongoClient } from 'mongodb';
import type { Db } from 'mongodb';
import { envSchema } from '../src/config/env.schema';
import { ensureRestaurantsSchema } from '../src/database/schema-bootstrap';
import { checkSearchIndex } from '../src/health/readiness';
import { AtlasTextSearch } from '../src/restaurants/atlas-text-search';
import type { ListCriteria } from '../src/restaurants/list-criteria';
import { MongoRestaurantStore } from '../src/restaurants/mongo-restaurant.store';
import { aRestaurantDocument, freshTenant } from './support/restaurant-store.contract';

const env = envSchema.parse(process.env);
const silent = { log: () => undefined, warn: () => undefined };

let client: MongoClient | undefined;
let db: Db;
let search: AtlasTextSearch;
let store: MongoRestaurantStore;

const tenant = freshTenant('atlas');
const ids: Record<'junction' | 'goli' | 'dosa' | 'chowpatty' | 'closed' | 'stall', string> = {
  junction: '',
  goli: '',
  dosa: '',
  chowpatty: '',
  closed: '',
  stall: '',
};

/** Tries until `done` accepts the answer, or fails after `timeoutMs` and shows the last answer. */
async function eventually<T>(
  attempt: () => Promise<T>,
  done: (value: T) => boolean,
  waitingFor: string,
  timeoutMs = 45_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await attempt();
    if (done(value)) return value;
    if (Date.now() > deadline) {
      throw new Error(
        `Gave up after ${timeoutMs} ms waiting for ${waitingFor}. Last answer: ${JSON.stringify(value)}. ` +
          'Is MongoDB the Atlas Local container (npm run db:up)? A plain MongoDB has no Atlas Search.',
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

const sorted = (list: string[] | null) => [...(list ?? [])].sort();

beforeAll(async () => {
  client = new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  db = client.db(env.MONGODB_DB);
  await ensureRestaurantsSchema(db, silent);
  store = new MongoRestaurantStore(db);
  search = new AtlasTextSearch(db, 5000);

  await eventually(
    () => checkSearchIndex(db, 5000),
    (index) => index.queryable,
    'the Atlas Search index to become queryable',
    90_000,
  );

  const place = (name: string, locality: string, extra: object = {}) =>
    aRestaurantDocument(tenant, {
      name,
      address: { line: null, locality, city: 'Gurgaon', country: { code: 'IN', name: 'India' } },
      ...extra,
    });
  ids.junction = (await store.insert(place('Vada Pav Junction', 'Cyber Hub'))).id;
  ids.goli = (await store.insert(place('Goli Vada Pav No. 1', 'Connaught Place'))).id;
  ids.dosa = (await store.insert(place('Dosa Plaza', 'Sector 29'))).id;
  ids.chowpatty = (await store.insert(place('Bombay Chowpatty', 'Girgaum'))).id;
  ids.closed = (await store.insert(place('Vada Pav Closed', 'Cyber Hub', { status: 'inactive' }))).id;
  ids.stall = (
    await store.insert(aRestaurantDocument(freshTenant('atlas-other'), { name: 'Vada Pav Stall' }))
  ).id;

  // Wait until every restaurant that a test looks for can be found.
  const howMany = async (word: string) => (await search.candidates(tenant, [word]))?.length ?? 0;
  await eventually(
    async () => ({ vada: await howMany('vada'), dosa: await howMany('dosa'), girgaum: await howMany('girgaum') }),
    (found) => found.vada === 2 && found.dosa === 1 && found.girgaum === 1,
    'Atlas Search to index the new restaurants',
  );
}, 180_000);

afterAll(async () => {
  if (db) await db.dropDatabase();
  await client?.close();
});

describe('AtlasTextSearch on a real Atlas Search', () => {
  it('names the restaurants whose name has every word, and no other', async () => {
    expect(sorted(await search.candidates(tenant, ['vada', 'pav']))).toEqual(
      sorted([ids.junction, ids.goli]),
    );
  });

  it('needs every word', async () => {
    expect(await search.candidates(tenant, ['vada', 'dosa'])).toEqual([]);
  });

  it('accepts the start of a word', async () => {
    expect(sorted(await search.candidates(tenant, ['vad']))).toEqual(sorted([ids.junction, ids.goli]));
    expect(sorted(await search.candidates(tenant, ['chow']))).toEqual([ids.chowpatty]);
  });

  it('accepts one typo in a word of four letters or more', async () => {
    expect(sorted(await search.candidates(tenant, ['vadda']))).toEqual(sorted([ids.junction, ids.goli]));
    expect(sorted(await search.candidates(tenant, ['chowpaty']))).toEqual([ids.chowpatty]);
  });

  it('looks in the area as well as in the name, and lets one word be in each', async () => {
    expect(await search.candidates(tenant, ['girgaum'])).toEqual([ids.chowpatty]);
    expect(await search.candidates(tenant, ['chowpatty', 'girgaum'])).toEqual([ids.chowpatty]);
    expect(await search.candidates(tenant, ['chowpatty', 'sector'])).toEqual([]);
  });

  it('never names an inactive restaurant or another tenant\'s restaurant', async () => {
    const found = await search.candidates(tenant, ['vada', 'pav']);

    expect(found).not.toContain(ids.closed);
    expect(found).not.toContain(ids.stall);
  });

  it('feeds the listing, which then applies the other filters and the sort', async () => {
    const criteria = (overrides: Partial<ListCriteria>): ListCriteria => ({
      cuisineMatch: 'any',
      sort: 'name',
      order: 'asc',
      limit: 20,
      offset: 0,
      ...overrides,
    });
    const candidates = (await search.candidates(tenant, ['vada', 'pav'])) ?? [];
    const names = async (overrides: Partial<ListCriteria>) =>
      (await store.list(tenant, criteria({ candidateIds: candidates, ...overrides }))).items.map(
        (item) => item.doc.name,
      );

    expect(await names({})).toEqual(['Goli Vada Pav No. 1', 'Vada Pav Junction']);
    expect(await names({ nameContains: 'junction' })).toEqual(['Vada Pav Junction']);
    expect(await names({ sort: 'name', order: 'desc' })).toEqual(['Vada Pav Junction', 'Goli Vada Pav No. 1']);
  });
});
