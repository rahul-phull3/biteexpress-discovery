import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Problem } from '../src/http/problem';
import type { RestaurantStore } from '../src/restaurants/restaurant.store';
import { FakeDb } from './support/fake-db';
import { InMemoryRestaurantStore } from './support/in-memory-restaurant-store';
import { createAppWithFakeMongo } from './support/test-app';

// GET /v1/restaurants/search through the whole HTTP stack (routing, query
// parsing, validation, the error filter, the headers) with the real controllers
// and no database. What the sentence is turned into is tested word by word in
// src/restaurants/search-text.spec.ts; this file checks what a client sees: the
// three examples of the brief, that the search does everything the list does,
// and the answers to requests it refuses.

const PROBLEM = /^application\/problem\+json/;
const SEARCH = '/v1/restaurants/search';
/** Zambar's coordinates, in Gurgaon: a place to stand. */
const HERE = '&lat=28.495&lng=77.089';

interface Item {
  id: string;
  name: string;
  city: string;
  cuisines: string[];
  costForTwo: number | null;
  averageRating: number | null;
  distanceKm?: number;
}

interface Page {
  data: Item[];
  page: { limit: number; offset: number; hasMore: boolean };
  meta: { sort: string; order: string; tookMs: number };
}

interface Found extends Page {
  interpretation: {
    q: string | null;
    summary: string;
    filters: Record<string, unknown>;
    words: string[];
    overridden: string[];
    notes: string[];
  };
}

let tenantCounter = 0;
/** A tenant of its own for a test, so tests cannot see each other's restaurants. */
const newTenant = () => `search-e2e-${++tenantCounter}`;

const inGurgaon = { city: 'Gurgaon', countryCode: 'IN' };
const inDelhi = { city: 'New Delhi', countryCode: 'IN' };

// Chosen so that every example of the brief has an answer that a wrong reading
// of the sentence would change: a better rated restaurant of another cuisine,
// the same cuisine in another city, a cost of exactly 1000, a "pav" without a "vada".
const restaurants = [
  {
    name: 'Naivedhyam',
    address: { line: '12 Main Road', locality: 'Sector 29', ...inGurgaon },
    location: { latitude: 28.4595, longitude: 77.0266 },
    cuisines: ['South Indian', 'Vegetarian'],
    cost: { forTwo: 800, priceRange: 2 },
    rating: { average: 4.3, votes: 4385 },
  },
  {
    name: 'Zambar',
    address: inGurgaon,
    location: { latitude: 28.495, longitude: 77.089 },
    cuisines: ['South Indian'],
    cost: { forTwo: 1200, priceRange: 3 },
    rating: { average: 4.0, votes: 802 },
  },
  {
    name: 'Dosa Corner',
    address: inGurgaon,
    cuisines: ['South Indian'],
    cost: { forTwo: 400, priceRange: 1 },
    rating: { average: 3.6, votes: 120 },
  },
  {
    name: 'Pizza Palace',
    address: inGurgaon,
    cuisines: ['Italian', 'Pizza'],
    cost: { forTwo: 900, priceRange: 2 },
    rating: { average: 4.8, votes: 2200 },
  },
  {
    name: 'Boundary Bistro',
    address: inGurgaon,
    cuisines: ['Continental'],
    cost: { forTwo: 1000, priceRange: 2 },
    rating: { average: 4.1, votes: 90 },
  },
  {
    name: 'Saravana Bhavan',
    address: inDelhi,
    cuisines: ['South Indian'],
    cost: { forTwo: 700, priceRange: 2 },
    rating: { average: 4.5, votes: 3100 },
  },
  {
    name: 'Goli Vada Pav No. 1',
    address: inDelhi,
    location: { latitude: 28.6315, longitude: 77.2167 },
    cuisines: ['Fast Food', 'Street Food'],
    cost: { forTwo: 150, priceRange: 1 },
    rating: { average: 3.9, votes: 500 },
  },
  {
    name: 'Vada Pav Junction',
    address: { locality: 'Cyber Hub', ...inGurgaon },
    location: { latitude: 28.46, longitude: 77.03 },
    cuisines: ['Fast Food'],
    cost: { forTwo: 200, priceRange: 1 },
    rating: { average: 3.5, votes: 60 },
  },
  {
    name: 'Pav Bhaji Point',
    address: inGurgaon,
    cuisines: ['Street Food'],
    cost: { forTwo: 300, priceRange: 1 },
    rating: { average: 3.8, votes: 300 },
  },
  { name: 'Unrated Cafe', address: inGurgaon, cuisines: ['Cafe'] },
];

describe('GET /v1/restaurants/search (e2e)', () => {
  let app: INestApplication;
  let tenant: string;

  const server = () => app.getHttpServer();
  const create = (forTenant: string, body: object) =>
    request(server()).post('/v1/restaurants').set('X-Tenant-Id', forTenant).send(body).expect(201);
  const find = (forTenant: string, query: string) =>
    request(server()).get(`${SEARCH}${query}`).set('X-Tenant-Id', forTenant);
  const found = async (forTenant: string, query: string): Promise<Found> =>
    (await find(forTenant, query).expect(200)).body as Found;
  const listed = async (forTenant: string, query: string): Promise<Page> =>
    (await request(server()).get(`/v1/restaurants${query}`).set('X-Tenant-Id', forTenant).expect(200)).body as Page;
  /** The query string for a sentence. */
  const ask = (sentence: string) => `?q=${encodeURIComponent(sentence)}`;
  const names = (page: Page) => page.data.map((item) => item.name);

  beforeAll(async () => {
    app = await createAppWithFakeMongo(new FakeDb(), { restaurantStore: new InMemoryRestaurantStore() });
    tenant = newTenant();
    for (const restaurant of restaurants) await create(tenant, restaurant);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('the examples of the brief', () => {
    it('answers "Best restaurants in Gurgaon with South Indian Food"', async () => {
      const res = await find(tenant, ask('Best restaurants in Gurgaon with South Indian Food')).expect(200);
      const result = res.body as Found;

      expect(res.headers['content-type']).toMatch(/application\/json/);
      // Pizza Palace is rated higher than all of them, and Saravana Bhavan serves South Indian food in Delhi.
      expect(names(result)).toEqual(['Naivedhyam', 'Zambar', 'Dosa Corner']);
      expect(result.meta).toMatchObject({ sort: 'rating', order: 'desc' });
      expect(result.interpretation).toEqual({
        q: 'Best restaurants in Gurgaon with South Indian Food',
        summary: 'South Indian restaurants in Gurgaon, best rated first',
        filters: { sort: 'rating', city: 'Gurgaon', cuisine: ['South Indian'] },
        words: [],
        overridden: [],
        notes: [],
      });
    });

    it('answers "Restaurants in Gurgaon under Rs. 1000 for two": under means below, so 1000 itself is out', async () => {
      const result = await found(tenant, ask('Restaurants in Gurgaon under Rs. 1000 for two'));

      // Boundary Bistro costs exactly 1000, Zambar 1200, and Unrated Cafe has no cost on record.
      expect(names(result)).toEqual(['Pizza Palace', 'Naivedhyam', 'Pav Bhaji Point', 'Dosa Corner', 'Vada Pav Junction']);
      expect(result.data.map((item) => item.costForTwo)).toEqual([900, 800, 300, 400, 200]);
      expect(result.data.every((item) => item.costForTwo !== null && item.costForTwo < 1000)).toBe(true);
      expect(result.interpretation).toMatchObject({
        summary: 'Restaurants in Gurgaon, average cost for two at most 999 INR, best rated first',
        filters: { city: 'Gurgaon', maxCost: 999, currency: 'INR' },
        notes: [],
      });
    });

    it('reads "up to Rs. 1000" as including 1000', async () => {
      const result = await found(tenant, ask('Restaurants in Gurgaon up to Rs. 1000 for two'));

      expect(names(result)).toContain('Boundary Bistro');
      expect(result.interpretation.filters).toMatchObject({ maxCost: 1000, currency: 'INR' });
    });

    it('answers "Nearest place that serves Vada Pav" for someone who says where they are', async () => {
      const result = await found(tenant, `${ask('Nearest place that serves Vada Pav')}${HERE}`);

      // Pav Bhaji Point has a "pav" but no "vada"; the words are looked for in names and areas, not in menus.
      expect(names(result)).toEqual(['Vada Pav Junction', 'Goli Vada Pav No. 1']);
      expect(result.meta).toMatchObject({ sort: 'distance', order: 'asc' });
      const km = result.data.map((item) => item.distanceKm ?? Number.NaN);
      expect(km[0]).toBeCloseTo(6.97, 1);
      expect(km[1]).toBeCloseTo(19.67, 1);
      expect(result.interpretation).toMatchObject({
        summary: 'Restaurants with "vada pav" in the name or area, nearest first',
        words: ['vada', 'pav'],
        overridden: [],
      });
      expect(result.interpretation.notes).toEqual([expect.stringContaining('The data has no menu items to search.')]);
    });

    it('still answers "Nearest place that serves Vada Pav" without a location, and says why it is not nearest', async () => {
      const result = await found(tenant, ask('Nearest place that serves Vada Pav'));

      expect(names(result)).toEqual(['Goli Vada Pav No. 1', 'Vada Pav Junction']);
      expect(result.meta).toMatchObject({ sort: 'rating', order: 'desc' });
      for (const item of result.data) expect(item).not.toHaveProperty('distanceKm');
      expect(result.interpretation.notes).toContain(
        'The text asks for something near you, but the request has no lat and lng, so distance was not used.',
      );
    });
  });

  describe('"near me"', () => {
    it('is within 5 km of the point, and the answer says so', async () => {
      const result = await found(tenant, `${ask('South Indian food near me')}${HERE}`);

      // Naivedhyam serves South Indian food too, but is 7.3 km away; Dosa Corner has no location.
      expect(names(result)).toEqual(['Zambar']);
      expect(result.data[0]?.distanceKm).toBe(0);
      expect(result.meta).toMatchObject({ sort: 'distance', order: 'asc' });
      expect(result.interpretation).toMatchObject({
        summary: 'South Indian restaurants, within 5 km, nearest first',
        filters: { cuisine: ['South Indian'], radiusKm: 5 },
        notes: ['"near me" was read as within 5 km.'],
      });
    });

    it('gives way to a distance in the sentence', async () => {
      const result = await found(tenant, `${ask('South Indian food within 8 km near me')}${HERE}`);

      expect(names(result)).toEqual(['Zambar', 'Naivedhyam']);
      expect(result.data[1]?.distanceKm).toBeCloseTo(7.27, 1);
      expect(result.interpretation.filters).toMatchObject({ radiusKm: 8 });
      expect(result.interpretation.notes).toEqual([]);
    });

    it('gives way to radiusKm in the request, and does not say that it read 5 km', async () => {
      const result = await found(tenant, `${ask('South Indian food near me')}${HERE}&radiusKm=8`);

      expect(names(result)).toEqual(['Zambar', 'Naivedhyam']);
      expect(result.interpretation.overridden).toEqual(['radiusKm']);
      expect(result.interpretation.notes).toEqual(["The request also sent radiusKm, so that was used instead of the text's."]);
    });

    it('is the best of those within 5 km when a word for the order is given', async () => {
      const result = await found(tenant, `${ask('top 3 restaurants near me')}${HERE}`);

      // Pizza Palace is the best rated of all, and has no location to be near.
      expect(names(result)).toEqual(['Zambar']);
      expect(result.meta).toMatchObject({ sort: 'rating', order: 'desc' });
    });

    it('cannot be answered without a point: the plain list, and a note that says why', async () => {
      const result = await found(tenant, ask('South Indian food near me'));

      // Best rated first, everywhere: Saravana Bhavan is in New Delhi.
      expect(names(result)).toEqual(['Saravana Bhavan', 'Naivedhyam', 'Zambar', 'Dosa Corner']);
      expect(result.interpretation.filters).toEqual({ cuisine: ['South Indian'] });
      expect(result.interpretation.notes).toEqual([
        'The text asks for something near you, but the request has no lat and lng, so distance was not used.',
      ]);
    });
  });

  describe('words that are not a place or a filter', () => {
    it('are looked for in the name and in the area', async () => {
      expect(names(await found(tenant, ask('cyber hub')))).toEqual(['Vada Pav Junction']);
      expect(names(await found(tenant, ask('pav bhaji')))).toEqual(['Pav Bhaji Point']);
    });

    it('must all be there: a restaurant with only some of them is not a match', async () => {
      expect(names(await found(tenant, ask('vada bhaji')))).toEqual([]);
    });

    it('answer 200 with an empty page and a note when nothing matches, not 404', async () => {
      const result = await found(tenant, ask('sushi'));

      expect(result.data).toEqual([]);
      expect(result.page).toEqual({ limit: 20, offset: 0, hasMore: false });
      expect(result.interpretation.notes).toContain(
        'No restaurant has all of these words in its name or area. Fewer words will match more.',
      );
    });
  });

  describe('everything the list does', () => {
    it.each([
      '',
      '?city=Gurgaon',
      '?city=Gurugram&cuisine=South%20Indian',
      '?cuisine=Fast%20Food,Cafe&sort=name',
      '?minRating=4&sort=cost&order=desc',
      '?country=India&currency=INR&minCost=300&maxCost=900&limit=3',
      '?name=vada&offset=1',
      '?lat=28.495&lng=77.089',
      '?lat=28.495&lng=77.089&radiusKm=8&sort=rating',
      '?sort=name&limit=4&offset=4',
    ])('gives what GET /v1/restaurants gives for "%s"', async (query) => {
      const searched = await found(tenant, query);
      const list = await listed(tenant, query);

      expect(searched.data.length).toBeGreaterThan(0);
      expect(searched.data).toEqual(list.data);
      expect(searched.page).toEqual(list.page);
      expect(searched.meta).toMatchObject({ sort: list.meta.sort, order: list.meta.order });
      expect(searched.interpretation).toEqual({
        q: null,
        summary: expect.any(String),
        filters: {},
        words: [],
        overridden: [],
        notes: [],
      });
    });
  });

  describe('a sentence together with parameters', () => {
    it('lets a parameter win over the sentence, and says so', async () => {
      const result = await found(tenant, `${ask('South Indian food in Gurgaon')}&city=New%20Delhi`);

      expect(names(result)).toEqual(['Saravana Bhavan']);
      expect(result.interpretation.filters).toEqual({ cuisine: ['South Indian'] });
      expect(result.interpretation.overridden).toEqual(['city']);
      expect(result.interpretation.notes).toEqual(["The request also sent city, so that was used instead of the text's."]);
    });

    it('adds a filter that the sentence does not speak of', async () => {
      const result = await found(tenant, `${ask('best South Indian')}&maxCost=800`);

      // Zambar costs 1200 for two.
      expect(names(result)).toEqual(['Saravana Bhavan', 'Naivedhyam', 'Dosa Corner']);
      expect(result.interpretation.overridden).toEqual([]);
    });

    it('counts like the list: "top 2" is a page of two with another after it, and limit beats it', async () => {
      const two = await found(tenant, ask('top 2 South Indian restaurants'));
      expect(names(two)).toEqual(['Saravana Bhavan', 'Naivedhyam']);
      expect(two.page).toEqual({ limit: 2, offset: 0, hasMore: true });

      const one = await found(tenant, `${ask('top 2 South Indian restaurants')}&limit=1`);
      expect(names(one)).toEqual(['Saravana Bhavan']);
      expect(one.page.limit).toBe(1);
      expect(one.interpretation.overridden).toEqual(['limit']);
    });

    it('pages through the matches without repeating or skipping one', async () => {
      const first = await found(tenant, `${ask('South Indian restaurants')}&limit=2`);
      const second = await found(tenant, `${ask('South Indian restaurants')}&limit=2&offset=2`);

      expect(names(first)).toEqual(['Saravana Bhavan', 'Naivedhyam']);
      expect(first.page.hasMore).toBe(true);
      expect(names(second)).toEqual(['Zambar', 'Dosa Corner']);
      expect(second.page).toEqual({ limit: 2, offset: 2, hasMore: false });
    });

    it('refuses a request that contradicts its own sentence, and names the parameter', async () => {
      const res = await find(tenant, `${ask('nearest pizza')}${HERE}&order=desc`).expect(400);

      expect(res.headers['content-type']).toMatch(PROBLEM);
      expect(res.body).toMatchObject({
        type: '/problems/validation-error',
        status: 400,
        instance: SEARCH,
        errors: [{ parameter: 'order', detail: 'distance can only be sorted nearest first' }],
      });
    });
  });

  describe('the answer', () => {
    it('can be reused by the app for 15 seconds, and depends on the tenant', async () => {
      const res = await find(tenant, ask('pizza')).expect(200);

      expect(res.headers['cache-control']).toBe('private, max-age=15');
      expect(res.headers.vary).toMatch(/X-Tenant-Id/i);
    });

    it("is not mistaken for GET /v1/restaurants/{id}: 'search' is a route, not a restaurant", async () => {
      for (const path of ['/v1/restaurants/search', '/v1/restaurants/search/']) {
        const res = await request(server()).get(path).set('X-Tenant-Id', tenant).expect(200);

        expect(res.body).toHaveProperty('interpretation');
        expect((res.body as Found).data).toHaveLength(restaurants.length);
      }
    });

    it("never shows another tenant's restaurants", async () => {
      const other = newTenant();
      await create(other, { name: 'Their Vada Pav', address: inDelhi, cuisines: ['Street Food'] });

      expect(names(await found(other, ask('vada pav')))).toEqual(['Their Vada Pav']);
      expect(names(await found(tenant, ask('vada pav')))).toEqual(['Goli Vada Pav No. 1', 'Vada Pav Junction']);
      expect(names(await found(newTenant(), ask('vada pav')))).toEqual([]);
    });

    it('knows a city as soon as a restaurant is created there', async () => {
      const fresh = newTenant();
      await create(fresh, { name: 'Gurgaon Grill', address: inGurgaon });

      const before = await found(fresh, ask('restaurants in Pune'));
      // Pune is not known yet, so it is only a word to look for in names and areas.
      expect(before.data).toEqual([]);
      expect(before.interpretation.words).toEqual(['pune']);

      await create(fresh, { name: 'Pune Place', address: { city: 'Pune', countryCode: 'IN' } });
      const after = await found(fresh, ask('restaurants in Pune'));
      expect(names(after)).toEqual(['Pune Place']);
      expect(after.interpretation.filters).toEqual({ city: 'Pune' });
    });
  });

  describe('a request it refuses', () => {
    const refusal = async (query: string, forTenant = tenant) => {
      const res = await find(forTenant, query).expect(400);
      expect(res.headers['content-type']).toMatch(PROBLEM);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toMatchObject({ type: '/problems/validation-error', status: 400, instance: SEARCH });
      return (res.body as Problem).errors ?? [];
    };

    it('names an unknown parameter, so a typo is not mistaken for "no filter"', async () => {
      expect(await refusal('?qq=pizza')).toEqual([{ parameter: 'qq', detail: 'Unknown parameter "qq". Remove it.' }]);
    });

    it('does not take an empty sentence for "everything"', async () => {
      expect(await refusal('?q=')).toEqual([{ parameter: 'q', detail: 'must not be empty' }]);
      expect(await refusal('?q=%20%20')).toEqual([{ parameter: 'q', detail: 'must not be empty' }]);
    });

    it('reads at most 200 characters of a sentence', async () => {
      await found(tenant, `?q=${'a'.repeat(200)}`);

      expect(await refusal(`?q=${'a'.repeat(201)}`)).toEqual([
        { parameter: 'q', detail: 'must be at most 200 characters' },
      ]);
    });

    it('does not take two sentences, or a query operator', async () => {
      expect(await refusal('?q=pizza&q=pasta')).toHaveLength(1);
      const errors = await refusal('?q[$ne]=pizza');
      expect(errors).toHaveLength(1);
      expect(errors[0]?.parameter).toMatch(/^q/);
    });

    it('explains parameters that only work together, as the list does', async () => {
      expect(await refusal('?q=pizza&lat=28.5')).toEqual([{ parameter: 'lng', detail: 'is required when lat is given' }]);
      expect(await refusal('?q=pizza&radiusKm=3')).toEqual([{ parameter: 'radiusKm', detail: 'needs lat and lng' }]);
      expect(await refusal('?lat=1&lng=2&order=desc')).toEqual([
        { parameter: 'order', detail: 'distance can only be sorted nearest first' },
      ]);
    });

    it('refuses an invalid tenant header here too', async () => {
      await request(server()).get(`${SEARCH}${ask('pizza')}`).set('X-Tenant-Id', 'bad tenant!').expect(400);
    });
  });

  describe('a sentence that looks like something else', () => {
    // Nothing in a sentence is a pattern or an operator: it is read for words, and words are matched as text.
    it.each([
      ['a pattern', '.*'],
      ['an unclosed group', '((('],
      ['an unclosed range', '[a-'],
      ['a backslash', '\\'],
      ['a query operator name', '$where'],
      ['JSON with an operator', '{"$ne":1}'],
      ['SQL', "'; drop table restaurants; --"],
      ['a lone percent sign', '%'],
      ['a NUL character', '\u0000'],
      ['emoji', '🍕 pizza 🍕'],
      ['full-width letters', 'ＰＩＺＺＡ'],
      ['one word of 200 letters', 'a'.repeat(200)],
      ['100 single letters', 'a '.repeat(100).trim()],
    ])('gets an answer, never an error, for %s', async (_what, sentence) => {
      const res = await find(tenant, ask(sentence)).expect(200);

      expect(Array.isArray((res.body as Found).data)).toBe(true);
    });
  });
});

describe('GET /v1/restaurants/search (e2e) when the store fails', () => {
  const leak = () => new Error('connection to mongodb://user:secret@db-7.internal reset');

  /** A store that works except for the one call that is named. */
  const failingAt = (call: 'list' | 'vocabulary'): RestaurantStore => ({
    insert: async () => {
      throw leak();
    },
    findById: async () => {
      throw leak();
    },
    list: async () => {
      if (call === 'list') throw leak();
      return { items: [], hasMore: false };
    },
    vocabulary: async () => {
      if (call === 'vocabulary') throw leak();
      return { cities: [], cuisines: [] };
    },
  });

  it.each(['list', 'vocabulary'] as const)('answers a failing %s with the same generic 500, uncached', async (call) => {
    const app = await createAppWithFakeMongo(new FakeDb(), { restaurantStore: failingAt(call) });
    try {
      const res = await request(app.getHttpServer())
        .get(`${SEARCH}?q=pizza`)
        .set('X-Request-Id', `trace-search-${call}`)
        .expect(500);

      expect(res.headers['content-type']).toMatch(PROBLEM);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toMatchObject({
        type: '/problems/internal-error',
        status: 500,
        requestId: `trace-search-${call}`,
      });
      expect(JSON.stringify(res.body)).not.toMatch(/secret|db-7|mongodb:/);
    } finally {
      await app.close();
    }
  });
});
