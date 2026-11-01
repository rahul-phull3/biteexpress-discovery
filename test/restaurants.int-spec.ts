// Integration tests for creating and fetching restaurants: these talk to a
// REAL MongoDB (the Atlas Local container). Start it first with `npm run db:up`,
// then run `npm run test:int`.
//
// They prove what the unit and e2e tests cannot: that the database accepts
// every document the API builds, that the unique index is what turns a
// repeated source into a 409, and that latitude and longitude really are
// stored as GeoJSON with longitude first. Like the other integration tests
// they use a throwaway database (see support/int-env.ts) and drop it at the end.
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
import { MongoRestaurantStore } from '../src/restaurants/mongo-restaurant.store';
import type { RestaurantResource } from '../src/restaurants/restaurant.resource';
import {
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

  it('keeps tenants apart: the other tenant gets a 404 for the same id', async () => {
    const owner = freshTenant('http');
    const created = await request(app.getHttpServer()).post('/v1/restaurants').set('X-Tenant-Id', owner).send(body).expect(201);
    const { id } = created.body as RestaurantResource;

    await request(app.getHttpServer()).get(`/v1/restaurants/${id}`).set('X-Tenant-Id', freshTenant('http')).expect(404);
  });
});
