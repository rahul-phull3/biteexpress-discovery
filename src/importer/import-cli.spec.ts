import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AnyBulkWriteOperation, Document, MongoClient } from 'mongodb';
import { zomatoCsv, zomatoRow } from '../../test/support/zomato-rows';
import {
  DEFAULT_BATCH_SIZE,
  DEFAULT_CSV,
  DEFAULT_TEXT_FIXES,
  parseImportArgs,
  runImportCli,
  USAGE,
  type CliDependencies,
} from './import-cli';
import { UsageError } from './cli-common';

const NOW = new Date('2026-10-30T12:00:00.000Z');

const env = {
  MONGODB_URI: 'mongodb://example:27017/?directConnection=true',
  MONGODB_DB: 'testdb',
  DEFAULT_TENANT_ID: 'env-tenant',
};

describe('parseImportArgs', () => {
  it('has defaults that run the committed sample', () => {
    expect(parseImportArgs([])).toEqual({
      help: false,
      file: DEFAULT_CSV,
      textFixes: DEFAULT_TEXT_FIXES,
      tenant: undefined,
      batchSize: DEFAULT_BATCH_SIZE,
      dryRun: false,
    });
    expect(DEFAULT_CSV).toBe('data/sample/zomato-sample.csv');
    expect(DEFAULT_TEXT_FIXES).toBe('data/text-fixes.json');
    expect(DEFAULT_BATCH_SIZE).toBe(1000);
  });

  it('reads every option', () => {
    expect(
      parseImportArgs([
        '--file',
        'data/full/zomato.csv',
        '--text-fixes',
        'other-fixes.json',
        '--tenant',
        'acme',
        '--batch-size',
        '250',
        '--dry-run',
      ]),
    ).toEqual({
      help: false,
      file: 'data/full/zomato.csv',
      textFixes: 'other-fixes.json',
      tenant: 'acme',
      batchSize: 250,
      dryRun: true,
    });
  });

  it('also reads --option=value', () => {
    expect(parseImportArgs(['--file=a.csv', '--batch-size=5']).file).toBe(
      'a.csv',
    );
  });

  it('reads --help and -h', () => {
    expect(parseImportArgs(['--help']).help).toBe(true);
    expect(parseImportArgs(['-h']).help).toBe(true);
  });

  it('refuses an option it does not know', () => {
    expect(() => parseImportArgs(['--nope'])).toThrow(UsageError);
    expect(() => parseImportArgs(['--nope'])).toThrow('--nope');
  });

  it('refuses a stray argument', () => {
    expect(() => parseImportArgs(['data/full/zomato.csv'])).toThrow(UsageError);
  });

  it('refuses an option that is missing its value', () => {
    expect(() => parseImportArgs(['--file'])).toThrow(UsageError);
    expect(() => parseImportArgs(['--file', ''])).toThrow(
      '--file needs a value',
    );
  });

  it('refuses a batch size that is not a whole number from 1 to 10000', () => {
    for (const size of ['0', '-1', '1.5', 'abc', '', '10001']) {
      expect(() => parseImportArgs(['--batch-size', size])).toThrow(
        '--batch-size',
      );
    }
    expect(parseImportArgs(['--batch-size', '1']).batchSize).toBe(1);
    expect(parseImportArgs(['--batch-size', '10000']).batchSize).toBe(10000);
  });

  it('refuses a tenant id the collection validator would not accept', () => {
    for (const tenant of ['a b', 'a/b', 'x'.repeat(65)]) {
      expect(() => parseImportArgs(['--tenant', tenant])).toThrow('--tenant');
    }
    expect(parseImportArgs(['--tenant', 'acme-eu_1']).tenant).toBe('acme-eu_1');
  });
});

/** Collects what the tool prints. */
function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      out: (text: string) => void out.push(text),
      err: (text: string) => void err.push(text),
    },
    out: () => out.join('\n'),
    err: () => err.join('\n'),
  };
}

interface FakeMongoOptions {
  connectError?: Error;
  ensureSchemaError?: Error;
  bulkWrite?: (
    operations: AnyBulkWriteOperation<Document>[],
  ) => Promise<unknown>;
}

/** A MongoDB that records the order of what the tool does to it. */
function fakeMongo(options: FakeMongoOptions = {}) {
  const events: string[] = [];
  const bulkWrites: AnyBulkWriteOperation<Document>[][] = [];
  const connects: Array<{ uri: string; appName: string }> = [];
  const collection = {
    bulkWrite: async (operations: AnyBulkWriteOperation<Document>[]) => {
      events.push('bulkWrite');
      bulkWrites.push(operations);
      if (options.bulkWrite) return options.bulkWrite(operations);
      return {
        upsertedCount: operations.length,
        matchedCount: 0,
        modifiedCount: 0,
      };
    },
    // Three documents, two of them with a location.
    countDocuments: async (filter: Document) => {
      events.push('countDocuments');
      return 'location' in filter ? 2 : 3;
    },
  };
  const db = {
    collection: (name: string) => {
      events.push(`collection:${name}`);
      return collection;
    },
  };
  const client = {
    db: (name: string) => {
      events.push(`db:${name}`);
      return db;
    },
    close: async () => {
      events.push('close');
    },
  };
  const dependencies: CliDependencies = {
    connect: async (uri, appName) => {
      connects.push({ uri, appName });
      if (options.connectError) throw options.connectError;
      events.push('connect');
      return client as unknown as MongoClient;
    },
    ensureSchema: async (_db, logger) => {
      events.push('ensureSchema');
      if (options.ensureSchemaError) throw options.ensureSchemaError;
      logger.log('Indexes in place: a, b');
      logger.warn('no search process');
    },
    now: () => NOW,
  };
  return { dependencies, events, bulkWrites, connects };
}

describe('runImportCli', () => {
  let directory: string;
  let threeRows: string;
  let badRow: string;
  let noFixes: string;

  const latin1 = (text: string) => Buffer.from(text, 'latin1');

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'import-cli-'));
    noFixes = join(directory, 'fixes.json');
    threeRows = join(directory, 'three.csv');
    badRow = join(directory, 'bad.csv');
    await writeFile(noFixes, '{}');
    await writeFile(
      threeRows,
      latin1(
        zomatoCsv([
          zomatoRow({ 'Restaurant ID': '1' }),
          zomatoRow({ 'Restaurant ID': '2', Latitude: '0', Longitude: '0' }),
          zomatoRow({ 'Restaurant ID': '3', 'Country Code': '216' }),
        ]),
      ),
    );
    await writeFile(
      badRow,
      latin1(
        zomatoCsv([
          zomatoRow({ 'Restaurant ID': '1' }),
          zomatoRow({ 'Restaurant ID': '2', 'Restaurant Name': '' }),
        ]),
      ),
    );
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const run = (
    argv: string[],
    mongo = fakeMongo(),
    environment: NodeJS.ProcessEnv = env,
  ) => {
    const output = capture();
    return runImportCli(argv, output.io, environment, mongo.dependencies).then(
      (code) => ({ code, out: output.out(), err: output.err(), mongo }),
    );
  };

  describe('help and wrong usage', () => {
    it('prints the usage and succeeds for --help', async () => {
      const result = await run(['--help']);

      expect(result.code).toBe(0);
      expect(result.out).toBe(USAGE);
      expect(result.err).toBe('');
      expect(USAGE).toContain('Usage: npm run import');
    });

    it('prints the problem and the usage, and returns 2, for an unknown option', async () => {
      const result = await run(['--nope']);

      expect(result.code).toBe(2);
      expect(result.err).toContain('--nope');
      expect(result.err).toContain(USAGE);
      expect(result.out).toBe('');
    });

    it('returns 2 for a bad value', async () => {
      const result = await run(['--batch-size', '0']);

      expect(result.code).toBe(2);
      expect(result.err).toContain('--batch-size');
    });

    it('returns 2 when the configuration is not valid, naming the variable', async () => {
      const result = await run(['--dry-run'], fakeMongo(), {
        MONGODB_URI: 'nope',
      });

      expect(result.code).toBe(2);
      expect(result.err).toContain('The configuration is not valid');
      expect(result.err).toContain('MONGODB_URI');
    });
  });

  describe('reading the files', () => {
    it('returns 1 and names the CSV file when it cannot be read', async () => {
      const missing = join(directory, 'missing.csv');

      const result = await run(['--file', missing, '--text-fixes', noFixes]);

      expect(result.code).toBe(1);
      expect(result.err).toContain(missing);
      expect(result.mongo.connects).toEqual([]);
    });

    it('returns 1 and says how to rebuild the fixes when they cannot be read', async () => {
      const result = await run([
        '--file',
        threeRows,
        '--text-fixes',
        join(directory, 'missing.json'),
      ]);

      expect(result.code).toBe(1);
      expect(result.err).toContain('npm run import:fixes');
      expect(result.mongo.connects).toEqual([]);
    });
  });

  describe('--dry-run', () => {
    it('cleans and reports without ever connecting to MongoDB', async () => {
      const result = await run([
        '--dry-run',
        '--file',
        threeRows,
        '--text-fixes',
        noFixes,
      ]);

      expect(result.code).toBe(0);
      expect(result.mongo.connects).toEqual([]);
      expect(result.mongo.events).toEqual([]);
      expect(result.out).toContain(
        'dry run, nothing written (tenant "env-tenant")',
      );
      expect(result.out).toContain('Rows read .................. 3');
      expect(result.out).toContain('Without a location ......... 1');
      expect(result.out).toContain('Result: PASS');
      expect(result.err).toBe('');
    });

    it('uses the tenant from --tenant over the one from the configuration', async () => {
      const result = await run([
        '--dry-run',
        '--tenant',
        'acme',
        '--file',
        threeRows,
        '--text-fixes',
        noFixes,
      ]);

      expect(result.out).toContain('(tenant "acme")');
    });

    it('returns 1 and lists the rows it had to reject', async () => {
      const result = await run([
        '--dry-run',
        '--file',
        badRow,
        '--text-fixes',
        noFixes,
      ]);

      expect(result.code).toBe(1);
      expect(result.out).toContain('Rejected rows (1):');
      expect(result.out).toContain('id 2: the name is empty');
      expect(result.out).toContain('Result: FAIL');
    });

    it('compares a file of 9,551 rows with the expected numbers and fails when they differ', async () => {
      const path = join(directory, 'big.csv');
      const rows = Array.from({ length: 9551 }, (_, index) =>
        zomatoRow({ 'Restaurant ID': String(index + 1) }),
      );
      await writeFile(path, latin1(zomatoCsv(rows)));

      const result = await run([
        '--dry-run',
        '--file',
        path,
        '--text-fixes',
        noFixes,
      ]);

      expect(result.code).toBe(1);
      expect(result.out).toContain('Checks against the full dataset');
      expect(result.out).toContain('[ok]   rows read: 9,551');
      expect(result.out).toContain(
        '[FAIL] texts repaired: expected 166, got 0',
      );
      expect(result.out).toContain('Result: FAIL');
    });
  });

  describe('importing into MongoDB', () => {
    it('connects, prepares the schema, writes, counts and disconnects, in that order', async () => {
      const result = await run(['--file', threeRows, '--text-fixes', noFixes]);

      expect(result.code).toBe(0);
      expect(result.mongo.events).toEqual([
        'connect',
        'db:testdb',
        'ensureSchema',
        'collection:restaurants',
        'bulkWrite',
        'countDocuments',
        'countDocuments',
        'close',
      ]);
    });

    it('connects with the configured address and its own application name', async () => {
      const result = await run(['--file', threeRows, '--text-fixes', noFixes]);

      expect(result.mongo.connects).toEqual([
        { uri: env.MONGODB_URI, appName: 'biteexpress-importer' },
      ]);
    });

    it('writes under the configured tenant, or the one given with --tenant', async () => {
      const fromEnv = await run(['--file', threeRows, '--text-fixes', noFixes]);
      const fromFlag = await run([
        '--file',
        threeRows,
        '--text-fixes',
        noFixes,
        '--tenant',
        'acme',
      ]);

      const tenantsOf = (mongo: ReturnType<typeof fakeMongo>) =>
        mongo.bulkWrites[0].map((operation) =>
          'updateOne' in operation
            ? operation.updateOne.filter.tenantId
            : undefined,
        );
      expect(tenantsOf(fromEnv.mongo)).toEqual([
        'env-tenant',
        'env-tenant',
        'env-tenant',
      ]);
      expect(tenantsOf(fromFlag.mongo)).toEqual(['acme', 'acme', 'acme']);
    });

    it('splits the writes into batches of --batch-size', async () => {
      const result = await run([
        '--file',
        threeRows,
        '--text-fixes',
        noFixes,
        '--batch-size',
        '2',
      ]);

      expect(
        result.mongo.bulkWrites.map((operations) => operations.length),
      ).toEqual([2, 1]);
    });

    it('prints the report with the target, the write totals and what the collection holds', async () => {
      const result = await run(['--file', threeRows, '--text-fixes', noFixes]);

      expect(result.out).toContain('testdb.restaurants, tenant "env-tenant"');
      expect(result.out).toContain(
        'inserted 3, matched 0, modified 0, failed 0',
      );
      expect(result.out).toContain('3 documents, 2 with a location');
      expect(result.out).toContain('Result: PASS');
    });

    it('shows what the schema step says, on the right stream', async () => {
      const result = await run(['--file', threeRows, '--text-fixes', noFixes]);

      expect(result.out).toContain('[schema] Indexes in place: a, b');
      expect(result.err).toContain('[schema] warning: no search process');
    });

    it('returns 1, says what stays and still disconnects, when the database stops answering', async () => {
      const mongo = fakeMongo({
        bulkWrite: async () => {
          throw new Error('connection closed');
        },
      });

      const result = await run(
        ['--file', threeRows, '--text-fixes', noFixes],
        mongo,
      );

      expect(result.code).toBe(1);
      expect(result.err).toContain('The import stopped: connection closed');
      expect(result.err).toContain('running the import again is safe');
      expect(result.mongo.events[result.mongo.events.length - 1]).toBe('close');
    });

    it('returns 1 and lists the rows the database refused', async () => {
      const mongo = fakeMongo({
        bulkWrite: async () => {
          throw Object.assign(new Error('bulk write failed'), {
            writeErrors: [
              { index: 1, code: 121, errmsg: 'Document failed validation' },
            ],
            result: { upsertedCount: 2, matchedCount: 0, modifiedCount: 0 },
          });
        },
      });

      const result = await run(
        ['--file', threeRows, '--text-fixes', noFixes],
        mongo,
      );

      expect(result.code).toBe(1);
      expect(result.out).toContain('Rows the database refused (1):');
      expect(result.out).toContain(
        'id 2: Document failed validation (code 121)',
      );
      expect(result.out).toContain(
        'inserted 2, matched 0, modified 0, failed 1',
      );
      expect(result.out).toContain('Result: FAIL');
    });

    it('returns 1 and writes nothing when the database cannot be reached', async () => {
      const mongo = fakeMongo({
        connectError: new Error(
          'Could not connect to MongoDB at mongodb://example:27017/',
        ),
      });

      const result = await run(
        ['--file', threeRows, '--text-fixes', noFixes],
        mongo,
      );

      expect(result.code).toBe(1);
      expect(result.err).toContain('Could not connect to MongoDB');
      expect(result.mongo.events).toEqual([]);
    });

    it('returns 1, writes nothing and disconnects when the schema cannot be prepared', async () => {
      const mongo = fakeMongo({
        ensureSchemaError: new Error('not authorised'),
      });

      const result = await run(
        ['--file', threeRows, '--text-fixes', noFixes],
        mongo,
      );

      expect(result.code).toBe(1);
      expect(result.err).toContain('not authorised');
      expect(result.mongo.bulkWrites).toEqual([]);
      expect(result.mongo.events[result.mongo.events.length - 1]).toBe('close');
    });
  });
});
