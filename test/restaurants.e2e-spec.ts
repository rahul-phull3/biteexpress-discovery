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
});
