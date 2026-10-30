// Integration tests for the importer: these talk to a REAL MongoDB (the Atlas
// Local container). Start it first with `npm run db:up`, then run `npm run test:int`.
//
// They prove what the unit tests cannot: that the database accepts everything
// the importer writes, that running it twice changes nothing but updatedAt, and
// that one refused restaurant costs one restaurant. Like the other integration
// tests they use a throwaway database (see support/int-env.ts) and drop it at
// the end, so your development data is never touched.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { MongoClient } from 'mongodb';
import type { Db, Document } from 'mongodb';
import { envSchema } from '../src/config/env.schema';
import { RESTAURANTS_COLLECTION } from '../src/database/restaurants.collection';
import { ensureRestaurantsSchema } from '../src/database/schema-bootstrap';
import { cleanRow } from '../src/importer/clean-row';
import { runImportCli } from '../src/importer/import-cli';
import {
  importRestaurants,
  type ImportOutcome,
} from '../src/importer/import-restaurants';
import type { ImportedRestaurant } from '../src/importer/imported-restaurant';
import { MongoRestaurantSink } from '../src/importer/mongo-restaurant-sink';
import { loadTextFixes, type TextFixes } from '../src/importer/text-fixes';
import { readZomatoCsv, type ZomatoRow } from '../src/importer/zomato-csv';

const env = envSchema.parse(process.env);
const silent = { log: () => undefined, warn: () => undefined };
const VALIDATION_FAILED = 121;

const SAMPLE = join(__dirname, '../data/sample/zomato-sample.csv');
const FULL = join(__dirname, '../data/full/zomato.csv');
const FIXES = join(__dirname, '../data/text-fixes.json');

const FIRST_RUN = new Date('2026-10-30T10:00:00.000Z');
const SECOND_RUN = new Date('2026-10-30T11:00:00.000Z');

let client: MongoClient | undefined;
let db: Db;
let rows: ZomatoRow[];
let fixes: TextFixes;

const restaurants = () => db.collection(RESTAURANTS_COLLECTION);

const sinkFor = (tenantId: string, now: Date) =>
  new MongoRestaurantSink(restaurants(), tenantId, now);

/** What `npm run import` does with the sample, without the command line. */
const importSample = (tenantId: string, now: Date): Promise<ImportOutcome> =>
  importRestaurants(rows, fixes, { batchSize: 200 }, sinkFor(tenantId, now));

/** The stored restaurant, found the way the importer finds it. */
const stored = (tenantId: string, id: string) =>
  restaurants().findOne({
    tenantId,
    'source.system': 'zomato',
    'source.id': id,
  });

/** A cleaned restaurant of the sample, by its Zomato id. */
function cleaned(id: string): ImportedRestaurant {
  const row = rows.find((candidate) => candidate['Restaurant ID'] === id);
  if (!row) throw new Error(`restaurant ${id} is not in the sample`);
  const result = cleanRow(row, fixes);
  if (!result.ok) throw new Error(`row ${id}: ${result.reason}`);
  return result.restaurant;
}

/** Runs the real command with the real database and collects what it prints. */
async function runCommand(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runImportCli(
    argv,
    {
      out: (text) => void out.push(text),
      err: (text) => void err.push(text),
    },
    process.env,
  );
  return { code, out: out.join('\n'), err: err.join('\n') };
}

/** Same documents with updatedAt blanked, to compare what a rerun changed besides it. */
const ignoringUpdatedAt = (documents: Document[]) =>
  documents.map((document) => ({ ...document, updatedAt: undefined }));

beforeAll(async () => {
  client = new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  db = client.db(env.MONGODB_DB);
  await ensureRestaurantsSchema(db, silent);
  rows = await readZomatoCsv(SAMPLE);
  fixes = await loadTextFixes(FIXES);
});

afterAll(async () => {
  if (db) await db.dropDatabase();
  await client?.close();
});

describe('importing the sample twice (real MongoDB)', () => {
  const tenant = 'it-twice';
  let first: ImportOutcome;
  let second: ImportOutcome;
  let afterFirst: Document[];
  let afterSecond: Document[];

  const everything = () =>
    restaurants().find({ tenantId: tenant }).sort({ 'source.id': 1 }).toArray();

  beforeAll(async () => {
    first = await importSample(tenant, FIRST_RUN);
    afterFirst = await everything();
    second = await importSample(tenant, SECOND_RUN);
    afterSecond = await everything();
  });

  it('creates every restaurant the first time, and the database accepts them all', () => {
    expect(first.rejected).toEqual([]);
    expect(first.writes).toEqual({
      inserted: 500,
      matched: 0,
      modified: 0,
      failures: [],
    });
    expect(first.collection).toEqual({ documents: 500, withLocation: 439 });
  });

  it('creates nothing the second time: all 500 are found and updated in place', () => {
    // modified is 500 as well because updatedAt moves on every run.
    expect(second.writes).toEqual({
      inserted: 0,
      matched: 500,
      modified: 500,
      failures: [],
    });
    expect(second.collection).toEqual({ documents: 500, withLocation: 439 });
  });

  it('holds exactly one document per restaurant afterwards', () => {
    expect(afterSecond).toHaveLength(500);
    expect(
      new Set(afterSecond.map((document) => document.source.id)).size,
    ).toBe(500);
  });

  it('keeps createdAt from the first run and moves updatedAt to the second', () => {
    const created = new Set(
      afterSecond.map((document) => document.createdAt.toISOString()),
    );
    const updated = new Set(
      afterSecond.map((document) => document.updatedAt.toISOString()),
    );

    expect([...created]).toEqual([FIRST_RUN.toISOString()]);
    expect([...updated]).toEqual([SECOND_RUN.toISOString()]);
  });

  it('changes nothing else: same documents, same _id, same content', () => {
    expect(ignoringUpdatedAt(afterSecond)).toEqual(
      ignoringUpdatedAt(afterFirst),
    );
  });

  describe('what is stored', () => {
    it('Farzi Cafe is complete, in the shape from the plan', async () => {
      const document = await restaurants().findOne(
        { tenantId: tenant, 'source.id': '308022' },
        { projection: { _id: 0 } },
      );

      expect(document).toEqual({
        tenantId: tenant,
        schemaVersion: 1,
        source: { system: 'zomato', id: '308022' },
        name: 'Farzi Cafe',
        address: {
          line: '7-8, Ground Floor, Cyber Hub, DLF Cyber City, Gurgaon',
          locality: 'Cyber Hub, DLF Cyber City',
          city: 'Gurgaon',
          country: { code: 'IN', name: 'India' },
        },
        location: { type: 'Point', coordinates: [77.0886879, 28.4952079] },
        cuisines: ['Modern Indian'],
        cost: { forTwo: 2200, currency: 'INR', priceRange: 4 },
        rating: {
          average: 4.3,
          votes: 4385,
          label: 'Very Good',
          score: 4.2903,
        },
        services: {
          tableBooking: false,
          onlineDelivery: false,
          deliveringNow: false,
        },
        status: 'active',
        dataQuality: [],
        createdAt: FIRST_RUN,
        updatedAt: SECOND_RUN,
      });
    });

    it('Café Daniel Briand in Brasília has its accents back and says so', async () => {
      const document = await stored(tenant, '6601005');

      expect(document?.name).toBe('Café Daniel Briand');
      expect(document?.address.city).toBe('Brasília');
      expect(document?.dataQuality).toEqual(['text_repaired']);
    });

    it('Rangrezz Restaurant in Agra is kept without a location, so no distance query returns it', async () => {
      const rangrezz = await stored(tenant, '3400341');
      expect(rangrezz).not.toBeNull();
      expect(rangrezz).not.toHaveProperty('location');
      expect(rangrezz?.dataQuality).toEqual(['coords_missing']);

      const agra = { type: 'Point', coordinates: [78.0081, 27.1767] };
      const byDistance = await restaurants()
        .aggregate([
          {
            $geoNear: {
              near: agra,
              distanceField: 'meters',
              query: { tenantId: tenant },
            },
          },
        ])
        .toArray();

      // Every stored location was accepted by the 2dsphere index, and only those.
      expect(byDistance).toHaveLength(439);
      expect(byDistance.map((row) => row.source.id)).not.toContain('3400341');
      const meters = byDistance.map((row) => row.meters as number);
      expect(meters).toEqual([...meters].sort((a, b) => a - b));
    });

    it('looks a restaurant up through the unique index, which is what makes the upsert fast', async () => {
      const plan = await restaurants()
        .find({
          tenantId: tenant,
          'source.system': 'zomato',
          'source.id': '308022',
        })
        .explain('queryPlanner');

      expect(JSON.stringify(plan.queryPlanner.winningPlan)).toContain(
        '"indexName":"tenant_source_unique"',
      );
    });
  });
});

describe('two tenants (real MongoDB)', () => {
  it('keeps a separate copy of the sample for each tenant', async () => {
    await importSample('it-tenant-a', FIRST_RUN);

    const other = await importSample('it-tenant-b', SECOND_RUN);

    // Tenant B's restaurants are new, not matches of tenant A's with the same ids.
    expect(other.writes).toMatchObject({ inserted: 500, matched: 0 });
    expect(
      await restaurants().countDocuments({ tenantId: 'it-tenant-a' }),
    ).toBe(500);
    expect(
      await restaurants().countDocuments({ tenantId: 'it-tenant-b' }),
    ).toBe(500);
    expect(
      await restaurants().countDocuments({
        tenantId: { $in: ['it-tenant-a', 'it-tenant-b'] },
        'source.id': '308022',
      }),
    ).toBe(2);
  });
});

describe('a rerun after the data or the rules changed (real MongoDB)', () => {
  it('removes a location the restaurant no longer has, and leaves fields it does not own alone', async () => {
    const tenant = 'it-rerun';
    const before = cleaned('308022');
    await sinkFor(tenant, FIRST_RUN).upsertBatch([before]);
    await restaurants().updateOne(
      { tenantId: tenant, 'source.id': '308022' },
      { $set: { favouriteDish: 'Vada Pav' } },
    );

    // The same restaurant, now without usable coordinates.
    const after: ImportedRestaurant = {
      ...before,
      dataQuality: ['coords_missing'],
    };
    delete after.location;
    const outcome = await sinkFor(tenant, SECOND_RUN).upsertBatch([after]);

    expect(outcome).toMatchObject({ inserted: 0, matched: 1, failures: [] });
    const document = await stored(tenant, '308022');
    expect(document).not.toBeNull();
    expect(document).not.toHaveProperty('location');
    expect(document?.dataQuality).toEqual(['coords_missing']);
    expect(document?.favouriteDish).toBe('Vada Pav');
    expect(document?.createdAt).toEqual(FIRST_RUN);
  });
});

describe('when the database refuses a restaurant (real MongoDB)', () => {
  it('refuses that restaurant alone, names it, and stores the rest of the batch', async () => {
    const tenant = 'it-refusal';
    const good = cleaned('308022');
    // The collection validator wants a name of at least one character.
    const refused: ImportedRestaurant = { ...cleaned('6601005'), name: '' };
    const alsoGood = cleaned('6600060');

    const outcome = await sinkFor(tenant, FIRST_RUN).upsertBatch([
      good,
      refused,
      alsoGood,
    ]);

    expect(outcome.inserted).toBe(2);
    expect(outcome.failures).toEqual([
      {
        sourceId: '6601005',
        message: expect.stringContaining(`code ${VALIDATION_FAILED}`),
      },
    ]);
    const ids = (await restaurants().find({ tenantId: tenant }).toArray())
      .map((document) => document.source.id as string)
      .sort();
    expect(ids).toEqual(['308022', '6600060']);
  });
});

describe('npm run import, end to end (real MongoDB)', () => {
  it('imports the sample, reports PASS, and a second run changes nothing', async () => {
    const argv = [
      '--file',
      SAMPLE,
      '--text-fixes',
      FIXES,
      '--tenant',
      'it-cli',
    ];

    const first = await runCommand(argv);
    const second = await runCommand(argv);

    for (const run of [first, second]) {
      expect({ code: run.code, report: run.out }).toEqual({
        code: 0,
        report: expect.stringContaining('Result: PASS'),
      });
    }
    expect(await restaurants().countDocuments({ tenantId: 'it-cli' })).toBe(
      500,
    );
    expect(
      await restaurants().countDocuments({
        tenantId: 'it-cli',
        location: { $exists: true },
      }),
    ).toBe(439);
  });
});

// The acceptance test of Step 3. It runs only when the take-home archive has been
// unzipped into data/full (that folder is not in Git), and then needs no other
// setup: the report itself compares the run with the expected numbers.
const describeWithFullCsv = existsSync(FULL) ? describe : describe.skip;

describeWithFullCsv(
  'the full dataset, data/full/zomato.csv (real MongoDB)',
  () => {
    it('imports 9,551 restaurants, matches every expected number, and a second run leaves 9,551', async () => {
      const argv = [
        '--file',
        FULL,
        '--text-fixes',
        FIXES,
        '--tenant',
        'it-full',
      ];

      const first = await runCommand(argv);
      const second = await runCommand(argv);

      for (const run of [first, second]) {
        expect({ code: run.code, report: run.out }).toEqual({
          code: 0,
          report: expect.stringContaining('Result: PASS'),
        });
      }
      expect(await restaurants().countDocuments({ tenantId: 'it-full' })).toBe(
        9551,
      );
    }, 240_000);
  },
);
