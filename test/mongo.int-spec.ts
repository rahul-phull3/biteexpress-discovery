// Integration tests: these talk to a REAL MongoDB (the Atlas Local container).
// Start it first with `npm run db:up`, then run `npm run test:int`.
//
// Each run uses its own throwaway database (see support/int-env.ts) and drops
// it at the end, so your development data is never touched.
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MongoClient } from 'mongodb';
import type { Db, Document } from 'mongodb';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { envSchema } from '../src/config/env.schema';
import {
  RESTAURANT_INDEX_NAMES,
  RESTAURANTS_COLLECTION,
} from '../src/database/restaurants.collection';
import { ensureRestaurantsSchema } from '../src/database/schema-bootstrap';
import type { ReadinessReport } from '../src/health/readiness';

const env = envSchema.parse(process.env);
const silent = { log: () => undefined, warn: () => undefined };
const VALIDATION_FAILED = 121;
const DUPLICATE_KEY = 11000;

let client: MongoClient | undefined;
let db: Db;

const restaurants = () => db.collection(RESTAURANTS_COLLECTION);

/** A valid restaurant in the shape from the plan, with fields you can override. */
function restaurant(overrides: Document = {}): Document {
  const now = new Date();
  return {
    tenantId: 'biteexpress',
    schemaVersion: 1,
    name: 'Farzi Cafe',
    address: {
      line: '7-8, Ground Floor, Cyber Hub, DLF Cyber City, Gurgaon',
      locality: 'Cyber Hub, DLF Cyber City',
      city: 'Gurgaon',
      zipcode: null,
      country: { code: 'IN', name: 'India' },
    },
    location: { type: 'Point', coordinates: [77.0886879, 28.4952079] },
    cuisines: ['Modern Indian'],
    cost: { forTwo: 2200, currency: 'INR', priceRange: 4 },
    rating: { average: 4.3, votes: 4385, label: 'Very Good', score: 4.29 },
    services: {
      tableBooking: false,
      onlineDelivery: false,
      deliveringNow: false,
    },
    media: { imageUrl: null, menuUrl: null },
    status: 'active',
    dataQuality: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

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

describe('restaurants collection (real MongoDB)', () => {
  it('has the $jsonSchema validator in strict mode', async () => {
    const res = await db.command({
      listCollections: 1,
      filter: { name: RESTAURANTS_COLLECTION },
    });
    const options = res.cursor.firstBatch[0].options;

    expect(options.validationLevel).toBe('strict');
    expect(options.validationAction).toBe('error');
    expect(options.validator.$jsonSchema.required).toContain('tenantId');
  });

  it('has every expected index', async () => {
    const indexes = await restaurants().listIndexes().toArray();

    expect(indexes.map((index) => index.name)).toEqual(
      expect.arrayContaining(['_id_', ...RESTAURANT_INDEX_NAMES]),
    );
  });

  it('can run the bootstrap again without error', async () => {
    await expect(ensureRestaurantsSchema(db, silent)).resolves.toBeUndefined();
  });

  it('refuses a document without its required fields', async () => {
    await expect(
      restaurants().insertOne({ name: 'No tenant, no address' }),
    ).rejects.toMatchObject({ code: VALIDATION_FAILED });
  });

  it('refuses coordinates outside the valid range', async () => {
    await expect(
      restaurants().insertOne(
        restaurant({ location: { type: 'Point', coordinates: [200, 100] } }),
      ),
    ).rejects.toMatchObject({ code: VALIDATION_FAILED });
  });

  it('refuses a status that is not allowed', async () => {
    await expect(
      restaurants().insertOne(restaurant({ status: 'archived' })),
    ).rejects.toMatchObject({ code: VALIDATION_FAILED });
  });

  it('accepts the document shape from the plan', async () => {
    const result = await restaurants().insertOne(
      restaurant({
        tenantId: 'shape-test',
        source: { system: 'zomato', id: '308022' },
      }),
    );

    expect(result.acknowledged).toBe(true);
  });

  it('accepts an extra field, so the schema can grow without a migration', async () => {
    const result = await restaurants().insertOne(
      restaurant({ tenantId: 'extra-field-test', favouriteDish: 'Vada Pav' }),
    );

    expect(result.acknowledged).toBe(true);
  });

  it('refuses a second restaurant with the same tenant and source id', async () => {
    const source = { system: 'zomato', id: '1' };
    await restaurants().insertOne(
      restaurant({ tenantId: 'unique-test', source }),
    );

    await expect(
      restaurants().insertOne(restaurant({ tenantId: 'unique-test', source })),
    ).rejects.toMatchObject({ code: DUPLICATE_KEY });
  });

  it('allows many restaurants without a source, because the unique index is partial', async () => {
    const results = await restaurants().insertMany([
      restaurant({ tenantId: 'partial-test', name: 'One' }),
      restaurant({ tenantId: 'partial-test', name: 'Two' }),
    ]);

    expect(results.insertedCount).toBe(2);
  });

  it('finds the nearest restaurants of one tenant with $geoNear', async () => {
    const here = { type: 'Point', coordinates: [77.0886879, 28.4952079] };
    const aboutOneKmNorth = {
      type: 'Point',
      coordinates: [77.0886879, 28.5052079],
    };
    await restaurants().insertMany([
      restaurant({ tenantId: 'geo-test', name: 'Here', location: here }),
      restaurant({
        tenantId: 'geo-test',
        name: 'About a kilometre away',
        location: aboutOneKmNorth,
      }),
      restaurant({
        tenantId: 'another-tenant',
        name: 'Other tenant, same spot',
        location: here,
      }),
    ]);

    const rows = await restaurants()
      .aggregate([
        {
          $geoNear: {
            near: here,
            distanceField: 'distanceMeters',
            query: { tenantId: 'geo-test' },
          },
        },
      ])
      .toArray();

    expect(rows.map((row) => row.name)).toEqual([
      'Here',
      'About a kilometre away',
    ]);
    expect(rows[0].distanceMeters).toBeLessThan(1);
    expect(rows[1].distanceMeters).toBeGreaterThan(1000);
    expect(rows[1].distanceMeters).toBeLessThan(1200);
  });
});

describe('GET /ready against a real MongoDB (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init(); // connects and runs the schema bootstrap
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns 200 and lists every expected index', async () => {
    const res = await request(app.getHttpServer()).get('/ready').expect(200);
    const body = res.body as ReadinessReport;

    expect(body.status).toBe('ready');
    expect(body.mongodb.status).toBe('up');
    expect(body.indexes.missing).toEqual([]);
    expect(body.indexes.present).toEqual(
      expect.arrayContaining(RESTAURANT_INDEX_NAMES),
    );
    // READY, BUILDING, UNAVAILABLE: depends on the deployment. Just show it.
    expect(typeof body.search.status).toBe('string');
  });
});
