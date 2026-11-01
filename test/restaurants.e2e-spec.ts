import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import type { Problem } from '../src/http/problem';
import type { RestaurantResource } from '../src/restaurants/restaurant.resource';
import type { RestaurantStore } from '../src/restaurants/restaurant.store';
import { FakeDb } from './support/fake-db';
import { InMemoryRestaurantStore } from './support/in-memory-restaurant-store';
import { createAppWithFakeMongo } from './support/test-app';

// The whole HTTP stack (routing, body parsing, validation, the error filter,
// the headers) with the real controllers and no database: restaurants live in
// an InMemoryRestaurantStore. test/restaurants.int-spec.ts repeats the key
// flows against a real MongoDB.

const body = {
  name: 'Naivedhyam',
  address: { line: '12 Main Road', locality: 'Sector 29', city: 'Gurgaon', countryCode: 'IN' },
  location: { latitude: 28.4595, longitude: 77.0266 },
  cuisines: ['South Indian', 'Vegetarian'],
  cost: { forTwo: 800, priceRange: 2 },
  rating: { average: 4.3, votes: 4385 },
  services: { onlineDelivery: true },
};

const PROBLEM = /^application\/problem\+json/;
const HEX_ID = /^[0-9a-f]{24}$/;

let tenantCounter = 0;
/** A tenant of its own for a test, so tests cannot see each other's restaurants. */
const newTenant = () => `e2e-${++tenantCounter}`;

describe('restaurants (e2e)', () => {
  let app: INestApplication;
  let store: InMemoryRestaurantStore;
  let defaultTenant: string;

  beforeAll(async () => {
    store = new InMemoryRestaurantStore();
    app = await createAppWithFakeMongo(new FakeDb(), { restaurantStore: store });
    defaultTenant = app.get(ConfigService).get<string>('DEFAULT_TENANT_ID') ?? '';
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();

  describe('POST /v1/restaurants', () => {
    it('creates the restaurant: 201, the entity, and a Location that leads to it', async () => {
      const tenant = newTenant();

      const res = await request(server()).post('/v1/restaurants').set('X-Tenant-Id', tenant).send(body).expect(201);
      const created = res.body as RestaurantResource;

      expect(created.id).toMatch(HEX_ID);
      expect(res.headers.location).toBe(`/v1/restaurants/${created.id}`);
      expect(created).toMatchObject({
        name: 'Naivedhyam',
        address: { city: 'Gurgaon', country: { code: 'IN', name: 'India' } },
        location: { latitude: 28.4595, longitude: 77.0266 },
        cuisines: ['South Indian', 'Vegetarian'],
        cost: { forTwo: 800, currency: 'INR', priceRange: 2 },
        rating: { average: 4.3, votes: 4385, label: 'Very Good', score: 4.2903 },
        services: { tableBooking: false, onlineDelivery: true, deliveringNow: false },
        status: 'active',
        dataQuality: [],
      });
      expect(Number.isNaN(Date.parse(created.createdAt))).toBe(false);
      expect(created).not.toHaveProperty('tenantId');
      expect(store.countFor(tenant)).toBe(1);
    });

    it('can be fetched through the Location it returned', async () => {
      const tenant = newTenant();
      const created = await request(server()).post('/v1/restaurants').set('X-Tenant-Id', tenant).send(body).expect(201);

      const fetched = await request(server())
        .get(created.headers.location as string)
        .set('X-Tenant-Id', tenant)
        .expect(200);

      expect(fetched.body).toEqual(created.body);
    });

    it('accepts the smallest body and says that the coordinates are missing', async () => {
      const res = await request(server())
        .post('/v1/restaurants')
        .set('X-Tenant-Id', newTenant())
        .send({ name: 'Tiny Cafe', address: { city: 'Gurgaon', countryCode: 'IN' } })
        .expect(201);

      expect(res.body).toMatchObject({ cuisines: [], dataQuality: ['coords_missing'] });
      expect(res.body).not.toHaveProperty('location');
    });

    it('stores the restaurant under the default tenant when no tenant header is sent', async () => {
      const res = await request(server()).post('/v1/restaurants').send(body).expect(201);

      const stored = await store.findById(defaultTenant, (res.body as RestaurantResource).id);
      expect(stored).not.toBeNull();
    });

    it('answers 400 as a problem document that lists every faulty field', async () => {
      const res = await request(server())
        .post('/v1/restaurants')
        .set('X-Tenant-Id', newTenant())
        .send({ name: '', address: { city: 'Gurgaon', countryCode: 'XX' }, cost: { priceRange: 9 } })
        .expect(400);
      const problem = res.body as Problem;

      expect(res.headers['content-type']).toMatch(PROBLEM);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(problem).toMatchObject({
        type: '/problems/validation-error',
        title: 'Validation failed',
        status: 400,
        instance: '/v1/restaurants',
      });
      expect((problem.errors ?? []).map((error) => error.pointer).sort()).toEqual([
        '#/address/countryCode',
        '#/cost/priceRange',
        '#/name',
      ]);
    });

    it('refuses fields the client does not own instead of ignoring them', async () => {
      const res = await request(server())
        .post('/v1/restaurants')
        .set('X-Tenant-Id', newTenant())
        .send({ ...body, tenantId: 'someone-else', createdAt: '2020-01-01T00:00:00Z' })
        .expect(400);

      expect((res.body as Problem).errors).toEqual(
        expect.arrayContaining([
          { pointer: '#/tenantId', detail: 'Unknown field "tenantId". Remove it.' },
          { pointer: '#/createdAt', detail: 'Unknown field "createdAt". Remove it.' },
        ]),
      );
    });

    it('answers a malformed JSON body with a 400 problem, not a stack trace', async () => {
      const res = await request(server())
        .post('/v1/restaurants')
        .set('Content-Type', 'application/json')
        .send('{"name": ')
        .expect(400);

      expect(res.headers['content-type']).toMatch(PROBLEM);
      expect(res.body).toMatchObject({ status: 400, title: 'Bad Request' });
      expect(JSON.stringify(res.body)).not.toContain('node_modules');
    });

    it('answers a request without a body with a 400 problem', async () => {
      const res = await request(server()).post('/v1/restaurants').expect(400);

      expect(res.headers['content-type']).toMatch(PROBLEM);
      expect(res.body).toMatchObject({ type: '/problems/validation-error', status: 400 });
    });

    it('answers 409 when the tenant already has a restaurant with the same source', async () => {
      const tenant = newTenant();
      const withSource = { ...body, source: { system: 'zomato', id: '18123456' } };
      await request(server()).post('/v1/restaurants').set('X-Tenant-Id', tenant).send(withSource).expect(201);

      const res = await request(server()).post('/v1/restaurants').set('X-Tenant-Id', tenant).send(withSource).expect(409);

      expect(res.headers['content-type']).toMatch(PROBLEM);
      expect(res.body).toMatchObject({
        type: '/problems/conflict',
        status: 409,
        errors: [{ pointer: '#/source' }],
      });
      expect(store.countFor(tenant)).toBe(1);
    });

    it('lets another tenant create a restaurant with the same source', async () => {
      const withSource = { ...body, source: { system: 'zomato', id: '99' } };
      await request(server()).post('/v1/restaurants').set('X-Tenant-Id', newTenant()).send(withSource).expect(201);

      await request(server()).post('/v1/restaurants').set('X-Tenant-Id', newTenant()).send(withSource).expect(201);
    });
  });

  describe('GET /v1/restaurants', () => {
    interface Page {
      data: Array<{
        id: string;
        name: string;
        address: string | null;
        city: string;
        country: string;
        cuisines: string[];
        averageRating: number | null;
        distanceKm?: number;
      }>;
      page: { limit: number; offset: number; hasMore: boolean };
      meta: { sort: string; order: string; tookMs: number };
    }

    const restaurants = [
      {
        name: 'Naivedhyam',
        address: { line: '12 Main Road', city: 'Gurgaon', countryCode: 'IN' },
        location: { latitude: 28.4595, longitude: 77.0266 },
        cuisines: ['South Indian', 'Vegetarian'],
        cost: { forTwo: 800, priceRange: 2 },
        rating: { average: 4.3, votes: 4385 },
      },
      {
        name: 'Zambar',
        address: { city: 'Gurgaon', countryCode: 'IN' },
        location: { latitude: 28.495, longitude: 77.089 },
        cuisines: ['South Indian'],
        cost: { forTwo: 1200, priceRange: 3 },
        rating: { average: 4.0, votes: 802 },
      },
      {
        name: 'Goli Vada Pav No. 1',
        address: { city: 'New Delhi', countryCode: 'IN' },
        location: { latitude: 28.6315, longitude: 77.2167 },
        cuisines: ['Fast Food', 'Street Food'],
        cost: { forTwo: 150, priceRange: 1 },
        rating: { average: 3.9, votes: 500 },
      },
      { name: 'Unrated Cafe', address: { city: 'Gurgaon', countryCode: 'IN' }, cuisines: ['Cafe'] },
    ];

    /** A tenant with the four restaurants above, created through the API itself. */
    async function seededTenant(): Promise<string> {
      const tenant = newTenant();
      for (const restaurant of restaurants) {
        await request(server()).post('/v1/restaurants').set('X-Tenant-Id', tenant).send(restaurant).expect(201);
      }
      return tenant;
    }

    const names = (page: Page) => page.data.map((item) => item.name);
    const get = (tenant: string, query: string) =>
      request(server()).get(`/v1/restaurants${query}`).set('X-Tenant-Id', tenant);
    const listed = async (tenant: string, query = ''): Promise<Page> => (await get(tenant, query).expect(200)).body as Page;

    let tenant: string;
    beforeAll(async () => {
      tenant = await seededTenant();
    });

    it('lists the restaurants, best first, as a page with the attributes the brief asks for', async () => {
      const res = await get(tenant, '').expect(200);
      const page = res.body as Page;

      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(names(page)).toEqual(['Naivedhyam', 'Zambar', 'Goli Vada Pav No. 1', 'Unrated Cafe']);
      expect(page.data[0]).toEqual({
        id: expect.stringMatching(HEX_ID),
        name: 'Naivedhyam',
        address: '12 Main Road',
        locality: null,
        city: 'Gurgaon',
        country: 'India',
        countryCode: 'IN',
        cuisines: ['South Indian', 'Vegetarian'],
        averageRating: 4.3,
        votes: 4385,
        costForTwo: 800,
        currency: 'INR',
      });
      expect(page.page).toEqual({ limit: 20, offset: 0, hasMore: false });
      expect(page.meta).toMatchObject({ sort: 'rating', order: 'desc' });
      expect(typeof page.meta.tookMs).toBe('number');
    });

    it('lets the app reuse the page for 15 seconds, and says that it depends on the tenant', async () => {
      const res = await get(tenant, '').expect(200);

      expect(res.headers['cache-control']).toBe('private, max-age=15');
      expect(res.headers.vary).toMatch(/X-Tenant-Id/i);
    });

    it("lists only the asking tenant's restaurants", async () => {
      expect(names(await listed(newTenant()))).toEqual([]);
      expect((await listed(tenant)).data.length).toBeGreaterThan(0);
    });

    it('finds the id that GET /v1/restaurants/{id} accepts', async () => {
      const [first] = (await listed(tenant)).data;

      const res = await request(server()).get(`/v1/restaurants/${first?.id}`).set('X-Tenant-Id', tenant).expect(200);

      expect(res.body).toMatchObject({ id: first?.id, name: 'Naivedhyam' });
    });

    it('filters by city in any letter case, and knows Gurugram as Gurgaon', async () => {
      const expected = ['Naivedhyam', 'Zambar', 'Unrated Cafe'];

      expect(names(await listed(tenant, '?city=Gurgaon'))).toEqual(expected);
      expect(names(await listed(tenant, '?city=gurgaon'))).toEqual(expected);
      expect(names(await listed(tenant, '?city=Gurugram'))).toEqual(expected);
      expect(names(await listed(tenant, '?city=New%20Delhi'))).toEqual(['Goli Vada Pav No. 1']);
      expect(names(await listed(tenant, '?city=Atlantis'))).toEqual([]);
    });

    it('filters by cuisine, given repeated or separated by commas, any or all of them', async () => {
      expect(names(await listed(tenant, '?cuisine=south%20indian'))).toEqual(['Naivedhyam', 'Zambar']);
      expect(names(await listed(tenant, '?cuisine=Vegetarian&cuisine=Cafe'))).toEqual(['Naivedhyam', 'Unrated Cafe']);
      expect(names(await listed(tenant, '?cuisine=Vegetarian,Cafe'))).toEqual(['Naivedhyam', 'Unrated Cafe']);
      expect(names(await listed(tenant, '?cuisine=South%20Indian,Vegetarian&cuisineMatch=all'))).toEqual(['Naivedhyam']);
    });

    it('filters by part of a name, by country, rating, cost and currency', async () => {
      expect(names(await listed(tenant, '?name=vada'))).toEqual(['Goli Vada Pav No. 1']);
      expect(names(await listed(tenant, '?country=India'))).toHaveLength(4);
      expect(names(await listed(tenant, '?country=US'))).toEqual([]);
      expect(names(await listed(tenant, '?minRating=4'))).toEqual(['Naivedhyam', 'Zambar']);
      expect(names(await listed(tenant, '?currency=INR&maxCost=800'))).toEqual(['Naivedhyam', 'Goli Vada Pav No. 1']);
      expect(names(await listed(tenant, '?currency=USD&maxCost=800'))).toEqual([]);
      expect(names(await listed(tenant, '?priceRange=3'))).toEqual(['Zambar']);
    });

    it('sorts and pages: the order is stable and every page says whether another follows', async () => {
      const first = await listed(tenant, '?sort=name&limit=2');
      const second = await listed(tenant, '?sort=name&limit=2&offset=2');

      expect(names(first)).toEqual(['Goli Vada Pav No. 1', 'Naivedhyam']);
      expect(first.page).toEqual({ limit: 2, offset: 0, hasMore: true });
      expect(first.meta).toMatchObject({ sort: 'name', order: 'asc' });
      expect(names(second)).toEqual(['Unrated Cafe', 'Zambar']);
      expect(second.page).toEqual({ limit: 2, offset: 2, hasMore: false });
    });

    it('can reverse the order', async () => {
      const page = await listed(tenant, '?sort=name&order=desc');

      expect(names(page)).toEqual(['Zambar', 'Unrated Cafe', 'Naivedhyam', 'Goli Vada Pav No. 1']);
    });

    it('with lat and lng, lists the nearest first and says how far each one is', async () => {
      const page = await listed(tenant, '?lat=28.495&lng=77.089');

      // Unrated Cafe has no coordinates, so it cannot be near anything.
      expect(names(page)).toEqual(['Zambar', 'Naivedhyam', 'Goli Vada Pav No. 1']);
      expect(page.meta).toMatchObject({ sort: 'distance', order: 'asc' });
      const km = page.data.map((item) => item.distanceKm ?? Number.NaN);
      expect(km[0]).toBe(0);
      expect(km[1]).toBeCloseTo(7.27, 1);
      expect(km[2]).toBeCloseTo(19.67, 1);
    });

    it('keeps only the restaurants within the radius', async () => {
      const page = await listed(tenant, '?lat=28.495&lng=77.089&radiusKm=8');

      expect(names(page)).toEqual(['Zambar', 'Naivedhyam']);
      expect(names(await listed(tenant, '?lat=28.495&lng=77.089&radiusKm=5'))).toEqual(['Zambar']);
    });

    it('can order the restaurants around a point by rating and still report the distance', async () => {
      const page = await listed(tenant, '?lat=28.495&lng=77.089&sort=rating');

      expect(names(page)).toEqual(['Naivedhyam', 'Zambar', 'Goli Vada Pav No. 1']);
      expect(page.data.every((item) => typeof item.distanceKm === 'number')).toBe(true);
    });

    it('has no distance when the request has no point', async () => {
      for (const item of (await listed(tenant)).data) expect(item).not.toHaveProperty('distanceKm');
    });

    describe('a request it refuses', () => {
      const refusal = async (query: string) => {
        const res = await get(tenant, query).expect(400);
        expect(res.headers['content-type']).toMatch(PROBLEM);
        expect(res.headers['cache-control']).toBe('no-store');
        expect(res.body).toMatchObject({ type: '/problems/validation-error', status: 400, instance: '/v1/restaurants' });
        return (res.body as Problem).errors ?? [];
      };

      it('names an unknown parameter, so a typo is not mistaken for "no filter"', async () => {
        expect(await refusal('?citty=Gurgaon')).toEqual([
          { parameter: 'citty', detail: 'Unknown parameter "citty". Remove it.' },
        ]);
      });

      it('names every malformed value at once', async () => {
        const errors = await refusal('?minRating=abc&limit=0&delivery=maybe&lat=95&lng=77');

        expect(errors.map((error) => error.parameter).sort()).toEqual(['delivery', 'lat', 'limit', 'minRating']);
      });

      it('explains parameters that only work together', async () => {
        expect(await refusal('?lat=28.5')).toEqual([{ parameter: 'lng', detail: 'is required when lat is given' }]);
        expect(await refusal('?radiusKm=3')).toEqual([{ parameter: 'radiusKm', detail: 'needs lat and lng' }]);
        expect(await refusal('?sort=distance')).toEqual([
          { parameter: 'sort', detail: 'distance needs lat and lng; there is nothing to measure from' },
        ]);
        expect(await refusal('?lat=1&lng=2&order=desc')).toEqual([
          { parameter: 'order', detail: 'distance can only be sorted nearest first' },
        ]);
      });

      it('does not let a query operator through', async () => {
        // Express 5 delivers ?city[$ne]=x as a parameter named "city[$ne]" (an older parser
        // would deliver an object); either way the query is refused and nothing is filtered.
        const errors = await refusal('?city[$ne]=Gurgaon');

        expect(errors).toHaveLength(1);
        expect(errors[0]?.parameter).toMatch(/^city/);
        await refusal('?name[$regex]=.*');
        await refusal('?minRating[$gt]=0');
      });

      it('does not take two values where one is expected', async () => {
        expect(await refusal('?city=Gurgaon&city=Noida')).toHaveLength(1);
        expect(await refusal('?limit=10&limit=20')).toHaveLength(1);
      });

      it('does not take a cuisine as an object', async () => {
        await refusal('?cuisine[$ne]=Thai');
      });

      it('never lets a page be larger than 50 or deeper than 1000', async () => {
        expect((await refusal('?limit=51'))[0]?.parameter).toBe('limit');
        expect((await refusal('?offset=1001'))[0]?.parameter).toBe('offset');
      });

      it('refuses an invalid tenant header here too', async () => {
        await request(server()).get('/v1/restaurants').set('X-Tenant-Id', 'bad tenant!').expect(400);
      });
    });

    it('is not mistaken for GET /v1/restaurants/{id}: a trailing slash lists too', async () => {
      const res = await request(server()).get('/v1/restaurants/').set('X-Tenant-Id', tenant).expect(200);

      expect((res.body as Page).data).toHaveLength(4);
    });
  });

  describe('GET /v1/restaurants/{id}', () => {
    async function createOne(tenant: string): Promise<RestaurantResource> {
      const res = await request(server()).post('/v1/restaurants').set('X-Tenant-Id', tenant).send(body).expect(201);
      return res.body as RestaurantResource;
    }

    it('returns the full restaurant with a cache lifetime and an ETag', async () => {
      const tenant = newTenant();
      const created = await createOne(tenant);

      const res = await request(server()).get(`/v1/restaurants/${created.id}`).set('X-Tenant-Id', tenant).expect(200);

      expect(res.body).toEqual(created);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.headers['cache-control']).toBe('private, max-age=30');
      expect(res.headers.vary).toMatch(/X-Tenant-Id/i);
      expect(res.headers.etag).toBeDefined();
    });

    it('answers 304 without a body when the app already has the current version', async () => {
      const tenant = newTenant();
      const created = await createOne(tenant);
      const first = await request(server()).get(`/v1/restaurants/${created.id}`).set('X-Tenant-Id', tenant).expect(200);

      const again = await request(server())
        .get(`/v1/restaurants/${created.id}`)
        .set('X-Tenant-Id', tenant)
        .set('If-None-Match', first.headers.etag as string)
        .expect(304);

      expect(again.text).toBe('');
    });

    it('answers 404 as a problem for an id nobody has, and never lets it be cached', async () => {
      const id = 'a'.repeat(24);

      const res = await request(server()).get(`/v1/restaurants/${id}`).set('X-Tenant-Id', newTenant()).expect(404);

      expect(res.headers['content-type']).toMatch(PROBLEM);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toMatchObject({
        type: '/problems/not-found',
        status: 404,
        instance: `/v1/restaurants/${id}`,
      });
    });

    it.each([['abc'], ['restaurantXY'], ['507f1f77bcf86cd79943901g'], ['%7B%22%24ne%22%3A1%7D']])(
      'answers 400, not 404 or 500, for the malformed id %s',
      async (id) => {
        const res = await request(server()).get(`/v1/restaurants/${id}`).set('X-Tenant-Id', newTenant()).expect(400);

        expect((res.body as Problem).errors).toEqual([
          { parameter: 'id', detail: 'must be a 24-character hexadecimal restaurant id' },
        ]);
      },
    );

    it("does not show one tenant's restaurant to another: 404, as if it did not exist", async () => {
      const owner = newTenant();
      const created = await createOne(owner);

      await request(server()).get(`/v1/restaurants/${created.id}`).set('X-Tenant-Id', owner).expect(200);
      await request(server()).get(`/v1/restaurants/${created.id}`).set('X-Tenant-Id', newTenant()).expect(404);
      await request(server()).get(`/v1/restaurants/${created.id}`).expect(404); // the default tenant
    });
  });

  describe('every route', () => {
    it('refuses a tenant header that is not a valid tenant id', async () => {
      const res = await request(server()).get(`/v1/restaurants/${'a'.repeat(24)}`).set('X-Tenant-Id', 'bad tenant!').expect(400);

      expect((res.body as Problem).errors).toEqual([
        { parameter: 'X-Tenant-Id', detail: 'use 1 to 64 letters, digits, underscores or hyphens' },
      ]);
    });

    it('returns the request id the caller sent, in the header and in the error body', async () => {
      const res = await request(server())
        .get(`/v1/restaurants/${'a'.repeat(24)}`)
        .set('X-Tenant-Id', newTenant())
        .set('X-Request-Id', 'trace-me-42')
        .expect(404);

      expect(res.headers['x-request-id']).toBe('trace-me-42');
      expect((res.body as Problem).requestId).toBe('trace-me-42');
    });

    it('makes a request id when the caller sends none', async () => {
      const res = await request(server()).get('/health').expect(200);

      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('answers an unknown route with a not-found problem, not an HTML page', async () => {
      const res = await request(server()).get('/v1/nothing-here').expect(404);

      expect(res.headers['content-type']).toMatch(PROBLEM);
      expect(res.body).toMatchObject({ type: '/problems/not-found', status: 404 });
    });
  });
});

describe('restaurants (e2e) when the store fails', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const broken: RestaurantStore = {
      insert: async () => {
        throw new Error('connection to mongodb://user:secret@db-7.internal reset');
      },
      findById: async () => {
        throw new Error('connection to mongodb://user:secret@db-7.internal reset');
      },
      list: async () => {
        throw new Error('connection to mongodb://user:secret@db-7.internal reset');
      },
      vocabulary: async () => ({ cities: [], cuisines: [] }),
    };
    app = await createAppWithFakeMongo(new FakeDb(), { restaurantStore: broken });
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers 500 with a generic problem that quotes the request id and leaks nothing', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/restaurants')
      .set('X-Request-Id', 'trace-500')
      .send(body)
      .expect(500);

    expect(res.headers['content-type']).toMatch(PROBLEM);
    expect(res.body).toMatchObject({
      type: '/problems/internal-error',
      status: 500,
      requestId: 'trace-500',
    });
    expect(JSON.stringify(res.body)).not.toMatch(/secret|db-7|mongodb:/);
  });

  it('answers a failing listing with the same generic 500, uncached', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/restaurants')
      .set('X-Request-Id', 'trace-list-500')
      .expect(500);

    expect(res.headers['content-type']).toMatch(PROBLEM);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({ type: '/problems/internal-error', status: 500, requestId: 'trace-list-500' });
    expect(JSON.stringify(res.body)).not.toMatch(/secret|db-7|mongodb:/);
  });
});
