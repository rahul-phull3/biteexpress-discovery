// Integration tests for creating and fetching restaurants: these talk to a
// REAL MongoDB (the Atlas Local container). Start it first with `npm run db:up`,
// then run `npm run test:int`.
//
// They prove what the unit and e2e tests cannot: that the database accepts
// every document the API builds, that the unique index is what turns a
// repeated source into a 409, that latitude and longitude really are stored as
// GeoJSON with longitude first, that the listing queries (including $geoNear)
// give the same answers as the in-memory stand-in, and that none of them scans
// the whole collection. Like the other integration tests they use a throwaway
// database (see support/int-env.ts) and drop it at the end.
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MongoClient, ObjectId } from 'mongodb';
import type { Db } from 'mongodb';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { envSchema } from '../src/config/env.schema';
import { RESTAURANTS_COLLECTION } from '../src/database/restaurants.collection';
import { ensureRestaurantsSchema } from '../src/database/schema-bootstrap';
import { buildRestaurantDocument } from '../src/restaurants/build-restaurant';
import { createRestaurantSchema } from '../src/restaurants/create-restaurant.schema';
import type { ListCriteria } from '../src/restaurants/list-criteria';
import { buildMongoListQuery, buildVocabularyPipelines, type MongoListQuery } from '../src/restaurants/mongo-list-query';
import { MongoRestaurantStore } from '../src/restaurants/mongo-restaurant.store';
import type { RestaurantListResponse } from '../src/restaurants/restaurant.list-item';
import type { RestaurantResource } from '../src/restaurants/restaurant.resource';
import {
  aRestaurantDocument,
  describeRestaurantListContract,
  describeRestaurantStoreContract,
  freshTenant,
} from './support/restaurant-store.contract';

const env = envSchema.parse(process.env);
const silent = { log: () => undefined, warn: () => undefined };

let client: MongoClient | undefined;
let db: Db;

beforeAll(async () => {
  client = new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  db = client.db(env.MONGODB_DB);
  await ensureRestaurantsSchema(db, silent);
});

afterAll(async () => {
  if (db) await db.dropDatabase();
  await client?.close();
});

// The same checks that run against the in-memory store in `npm test`.
describeRestaurantStoreContract(
  'MongoRestaurantStore',
  () => new MongoRestaurantStore(db),
);
describeRestaurantListContract(
  'MongoRestaurantStore',
  () => new MongoRestaurantStore(db),
);

describe('the listing queries on real data', () => {
  const tenant = freshTenant('plans');
  const store = () => new MongoRestaurantStore(db);

  const criteria = (overrides: Partial<ListCriteria> = {}): ListCriteria => ({
    cuisineMatch: 'any',
    sort: 'rating',
    order: 'desc',
    limit: 20,
    offset: 0,
    ...overrides,
  });

  /**
   * What MongoDB says it will do with a query, as one piece of text. Only the
   * stage names and index names in it are looked at, so the check does not depend
   * on how the server version lays out the plan.
   */
  async function planOf(query: MongoListQuery): Promise<string> {
    const collection = db.collection(RESTAURANTS_COLLECTION);
    const explained =
      query.kind === 'find'
        ? await collection
            .find(query.filter, { projection: query.projection })
            .sort(query.sort)
            .skip(query.skip)
            .limit(query.limit)
            .explain('queryPlanner')
        : await collection.aggregate(query.pipeline).explain('queryPlanner');
    return JSON.stringify(explained);
  }

  beforeAll(async () => {
    const cities: Array<[string, number, number]> = [
      ['Gurgaon', 28.4595, 77.0266],
      ['Mumbai', 19.076, 72.8777],
      ['Pune', 18.5204, 73.8567],
    ];
    const cuisines = [['South Indian'], ['North Indian', 'Mughlai'], ['Cafe', 'Italian'], ['Chinese']];
    for (const [city, latitude, longitude] of cities) {
      for (let index = 0; index < 20; index += 1) {
        await store().insert(
          aRestaurantDocument(tenant, {
            name: `${city} Place ${index}`,
            address: { line: null, locality: null, city, country: { code: 'IN', name: 'India' } },
            location: {
              type: 'Point',
              coordinates: [longitude + index * 0.002, latitude + index * 0.002],
            },
            cuisines: cuisines[index % cuisines.length] ?? [],
            rating: { average: 3 + (index % 10) / 5, votes: 10 * index, label: 'Good', score: 3 + (index % 10) / 5 },
          }),
        );
      }
    }
  });

  describe('use an index and never read the whole collection', () => {
    const shapes: Array<[string, Partial<ListCriteria>]> = [
      ['the default listing', {}],
      ['a city, best first', { city: 'Gurgaon' }],
      ['a city and a cuisine, best first', { city: 'Gurgaon', cuisines: ['South Indian'] }],
      ['a country, best first', { countryCode: 'IN' }],
      ['a rating bound', { minRating: 4 }],
      ['a part of a name', { nameContains: 'place 1' }],
      ['a price filter', { currency: 'INR', maxCost: 900 }],
      ['the cheapest first', { sort: 'cost', order: 'asc' }],
      ['by name', { sort: 'name', order: 'asc' }],
      ['by city', { sort: 'city', order: 'asc' }],
    ];

    it.each(shapes)('%s', async (_label, overrides) => {
      const plan = await planOf(buildMongoListQuery(tenant, criteria(overrides)));

      expect(plan).not.toContain('COLLSCAN');
      expect(plan).toContain('IXSCAN');
    });

    it('nearest first uses the 2dsphere index', async () => {
      const near = { latitude: 28.4595, longitude: 77.0266 };

      const plan = await planOf(buildMongoListQuery(tenant, criteria({ near, sort: 'distance', order: 'asc' })));

      expect(plan).toContain('tenant_location_2dsphere');
      expect(plan).not.toContain('COLLSCAN');
    });

    it('nearest first within a radius, ordered by rating, uses it too', async () => {
      const near = { latitude: 28.4595, longitude: 77.0266, radiusKm: 5 };

      const plan = await planOf(buildMongoListQuery(tenant, criteria({ near })));

      expect(plan).toContain('tenant_location_2dsphere');
      expect(plan).not.toContain('COLLSCAN');
    });

    it('the vocabulary reads the tenant through an index', async () => {
      const { cities, cuisines } = buildVocabularyPipelines(tenant);
      const collection = db.collection(RESTAURANTS_COLLECTION);

      for (const pipeline of [cities, cuisines]) {
        const plan = JSON.stringify(await collection.aggregate(pipeline).explain('queryPlanner'));
        expect(plan).not.toContain('COLLSCAN');
      }
    });
  });

  it('reads the cities and cuisines it was given', async () => {
    const vocabulary = await store().vocabulary(tenant);

    expect(vocabulary.cities).toEqual([
      { name: 'Gurgaon', count: 20 },
      { name: 'Mumbai', count: 20 },
      { name: 'Pune', count: 20 },
    ]);
    expect(vocabulary.cuisines.map((cuisine) => cuisine.name)).toEqual([
      'Cafe',
      'Chinese',
      'Italian',
      'Mughlai',
      'North Indian',
      'South Indian',
    ]);
  });

  it('measures the distances the haversine formula gives, to 10 metres', async () => {
    const near = { latitude: 28.4595, longitude: 77.0266 };

    const result = await store().list(tenant, criteria({ near, sort: 'distance', order: 'asc', limit: 3 }));

    // Each restaurant is 0.002 degrees further north and east than the one before.
    expect(result.items.map((item) => item.doc.name)).toEqual(['Gurgaon Place 0', 'Gurgaon Place 1', 'Gurgaon Place 2']);
    expect(result.items.map((item) => item.distanceKm)).toEqual([0, 0.3, 0.59]);
  });
});

describe('documents built from API input (real MongoDB validator)', () => {
  const NOW = new Date('2026-11-01T10:30:00.000Z');
  const bodies: Array<[string, unknown]> = [
    ['the smallest body', { name: 'Tiny Cafe', address: { city: 'Gurgaon', countryCode: 'IN' } }],
    [
      'a full body',
      {
        name: 'Naivedhyam',
        address: { line: '12 Main Road', locality: 'Sector 29', city: 'Gurgaon', countryCode: 'IN' },
        location: { latitude: 28.4595, longitude: 77.0266 },
        cuisines: ['South Indian', 'Vegetarian'],
        cost: { forTwo: 800, priceRange: 2 },
        rating: { average: 4.3, votes: 4385 },
        services: { tableBooking: true, onlineDelivery: true, deliveringNow: true },
        source: { system: 'zomato', id: 'int-full' },
      },
    ],
    ['an unrated restaurant with votes', { name: 'Quiet Place', address: { city: 'Pune', countryCode: 'IN' }, rating: { votes: 12 } }],
    ['a whole-number average', { name: 'Four Stars', address: { city: 'Pune', countryCode: 'IN' }, rating: { average: 4, votes: 1 } }],
    ['a restaurant abroad', { name: 'Joe', address: { city: 'New York', countryCode: 'US' }, location: { latitude: 40.7128, longitude: -74.006 } }],
    ['a name of 200 characters', { name: 'n'.repeat(200), address: { city: 'Gurgaon', countryCode: 'IN' } }],
  ];

  it.each(bodies)('accepts %s and reads it back unchanged', async (_label, body) => {
    const store = new MongoRestaurantStore(db);
    const doc = buildRestaurantDocument(createRestaurantSchema.parse(body), {
      tenantId: freshTenant('built'),
      now: NOW,
    });

    const { id } = await store.insert(doc);

    expect(await store.findById(doc.tenantId, id)).toEqual({ id, doc });
  });
});

describe('the API on a real MongoDB', () => {
  let app: INestApplication;
  const restaurants = () => db.collection(RESTAURANTS_COLLECTION);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  const body = {
    name: 'Naivedhyam',
    address: { city: 'Gurgaon', countryCode: 'IN' },
    location: { latitude: 28.4595, longitude: 77.0266 },
    cuisines: ['South Indian'],
    rating: { average: 4.3, votes: 4385 },
  };

  it('creates a restaurant, stores its location as GeoJSON with longitude first, and returns it by id', async () => {
    const tenant = freshTenant('http');
    const created = await request(app.getHttpServer())
      .post('/v1/restaurants')
      .set('X-Tenant-Id', tenant)
      .send(body)
      .expect(201);
    const { id } = created.body as RestaurantResource;

    const stored = await restaurants().findOne({ _id: new ObjectId(id) });
    expect(stored).toMatchObject({
      tenantId: tenant,
      status: 'active',
      location: { type: 'Point', coordinates: [77.0266, 28.4595] },
    });

    const fetched = await request(app.getHttpServer())
      .get(`/v1/restaurants/${id}`)
      .set('X-Tenant-Id', tenant)
      .expect(200);
    expect(fetched.body).toEqual(created.body);
  });

  it('answers 409 for a repeated source because the unique index says no', async () => {
    const tenant = freshTenant('http');
    const withSource = { ...body, source: { system: 'zomato', id: 'dup-1' } };
    await request(app.getHttpServer()).post('/v1/restaurants').set('X-Tenant-Id', tenant).send(withSource).expect(201);

    const second = await request(app.getHttpServer())
      .post('/v1/restaurants')
      .set('X-Tenant-Id', tenant)
      .send(withSource)
      .expect(409);

    expect(second.body).toMatchObject({ type: '/problems/conflict', errors: [{ pointer: '#/source' }] });
    expect(await restaurants().countDocuments({ tenantId: tenant })).toBe(1);
  });

  it('lists what was created: filters by city under another spelling, orders by distance, reports the distance', async () => {
    const tenant = freshTenant('http');
    const zambar = { ...body, name: 'Zambar', location: { latitude: 28.495, longitude: 77.089 }, rating: { average: 4, votes: 802 } };
    const goli = {
      name: 'Goli Vada Pav No. 1',
      address: { city: 'New Delhi', countryCode: 'IN' },
      location: { latitude: 28.6315, longitude: 77.2167 },
      cuisines: ['Street Food'],
    };
    for (const restaurant of [body, zambar, goli]) {
      await request(app.getHttpServer()).post('/v1/restaurants').set('X-Tenant-Id', tenant).send(restaurant).expect(201);
    }

    const gurugram = await request(app.getHttpServer())
      .get('/v1/restaurants?city=gurugram&lat=28.495&lng=77.089')
      .set('X-Tenant-Id', tenant)
      .expect(200);
    const everywhere = await request(app.getHttpServer())
      .get('/v1/restaurants?lat=28.495&lng=77.089&radiusKm=10')
      .set('X-Tenant-Id', tenant)
      .expect(200);

    const page = gurugram.body as RestaurantListResponse;
    expect(page.data.map((item) => [item.name, item.distanceKm])).toEqual([
      ['Zambar', 0],
      ['Naivedhyam', 7.27],
    ]);
    expect(page.meta).toMatchObject({ sort: 'distance', order: 'asc' });
    expect((everywhere.body as RestaurantListResponse).data.map((item) => item.name)).toEqual(['Zambar', 'Naivedhyam']);
  });

  it('sees a restaurant in a brand-new city at once, in any letter case', async () => {
    const tenant = freshTenant('http');
    await request(app.getHttpServer()).get('/v1/restaurants').set('X-Tenant-Id', tenant).expect(200);

    await request(app.getHttpServer())
      .post('/v1/restaurants')
      .set('X-Tenant-Id', tenant)
      .send({ name: 'Pune Place', address: { city: 'Pune', countryCode: 'IN' } })
      .expect(201);
    const res = await request(app.getHttpServer()).get('/v1/restaurants?city=PUNE').set('X-Tenant-Id', tenant).expect(200);

    expect((res.body as RestaurantListResponse).data.map((item) => item.name)).toEqual(['Pune Place']);
  });

  it('keeps tenants apart: the other tenant gets a 404 for the same id', async () => {
    const owner = freshTenant('http');
    const created = await request(app.getHttpServer()).post('/v1/restaurants').set('X-Tenant-Id', owner).send(body).expect(201);
    const { id } = created.body as RestaurantResource;

    await request(app.getHttpServer()).get(`/v1/restaurants/${id}`).set('X-Tenant-Id', freshTenant('http')).expect(404);
  });
});
