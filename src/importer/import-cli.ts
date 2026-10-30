import type { Db, MongoClient } from 'mongodb';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { envSchema, TENANT_ID_PATTERN, type Env } from '../config/env.schema';
import { connectMongo } from '../database/mongo-client.factory';
import { describeError } from '../database/mongo-errors';
import { RESTAURANTS_COLLECTION } from '../database/restaurants.collection';
import {
  ensureRestaurantsSchema,
  type BootstrapLogger,
} from '../database/schema-bootstrap';
import {
  EXIT_FAILED,
  EXIT_OK,
  EXIT_USAGE,
  UsageError,
  type CliIo,
} from './cli-common';
import { expectedNumbersFor } from './expected-report';
import {
  compareWithExpected,
  formatReport,
  reportPassed,
  type ImportReport,
} from './import-report';
import { importRestaurants, type ImportOutcome } from './import-restaurants';
import { MongoRestaurantSink } from './mongo-restaurant-sink';
import { loadTextFixes, type TextFixes } from './text-fixes';
import { readZomatoCsv, type ZomatoRow } from './zomato-csv';

export const DEFAULT_CSV = 'data/sample/zomato-sample.csv';
export const DEFAULT_TEXT_FIXES = 'data/text-fixes.json';
export const DEFAULT_BATCH_SIZE = 1000;
export const MAX_BATCH_SIZE = 10_000;

export const USAGE = `Usage: npm run import -- [options]

Cleans a Zomato restaurant CSV and loads it into MongoDB. Running it again is
safe: a restaurant is matched on tenant + source system + source id, so a second
run updates in place and never creates duplicates.

Options:
  --file <path>         CSV to import (default: ${DEFAULT_CSV})
  --text-fixes <path>   Corrected texts by restaurant id (default: ${DEFAULT_TEXT_FIXES})
  --tenant <id>         Tenant that owns the data (default: DEFAULT_TENANT_ID, "biteexpress")
  --batch-size <n>      Restaurants per bulk write, 1 to ${MAX_BATCH_SIZE} (default: ${DEFAULT_BATCH_SIZE})
  --dry-run             Clean and report only. Does not connect to MongoDB.
  -h, --help            Show this help

Examples:
  npm run import:dry
  npm run import
  npm run import -- --file data/full/zomato.csv`;

export interface ImportOptions {
  help: boolean;
  file: string;
  textFixes: string;
  /** Undefined means DEFAULT_TENANT_ID from the configuration. */
  tenant: string | undefined;
  batchSize: number;
  dryRun: boolean;
}

/** Reads the command line. Throws UsageError for anything the tool cannot act on. */
export function parseImportArgs(argv: readonly string[]): ImportOptions {
  let values;
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        file: { type: 'string' },
        'text-fixes': { type: 'string' },
        tenant: { type: 'string' },
        'batch-size': { type: 'string' },
        'dry-run': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    throw new UsageError(describeError(error));
  }

  return {
    help: values.help ?? false,
    file: nonEmpty('--file', values.file) ?? DEFAULT_CSV,
    textFixes:
      nonEmpty('--text-fixes', values['text-fixes']) ?? DEFAULT_TEXT_FIXES,
    tenant: parseTenant(values.tenant),
    batchSize: parseBatchSize(values['batch-size']),
    dryRun: values['dry-run'] ?? false,
  };
}

function nonEmpty(flag: string, value: string | undefined): string | undefined {
  if (value !== undefined && value.trim() === '') {
    throw new UsageError(`${flag} needs a value`);
  }
  return value;
}

function parseTenant(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!TENANT_ID_PATTERN.test(value)) {
    throw new UsageError(
      `--tenant must be 1 to 64 letters, digits, underscores or hyphens, got "${value}"`,
    );
  }
  return value;
}

function parseBatchSize(value: string | undefined): number {
  if (value === undefined) return DEFAULT_BATCH_SIZE;
  const size = /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isInteger(size) || size < 1 || size > MAX_BATCH_SIZE) {
    throw new UsageError(
      `--batch-size must be a whole number from 1 to ${MAX_BATCH_SIZE}, got "${value}"`,
    );
  }
  return size;
}

/** The outside world the tool touches besides the files: the database and the clock. */
export interface CliDependencies {
  connect(uri: string, appName: string): Promise<MongoClient>;
  ensureSchema(db: Db, logger: BootstrapLogger): Promise<void>;
  now(): Date;
}

const realDependencies: CliDependencies = {
  connect: connectMongo,
  ensureSchema: ensureRestaurantsSchema,
  now: () => new Date(),
};

/**
 * `npm run import`: read the CSV, clean it, load it, print the report.
 * Returns the exit code instead of exiting, so tests can call it.
 *
 * 0 = the report passed, 1 = the run did not succeed, 2 = wrong usage or configuration.
 */
export async function runImportCli(
  argv: readonly string[],
  io: CliIo,
  env: NodeJS.ProcessEnv,
  dependencies: CliDependencies = realDependencies,
): Promise<number> {
  let options: ImportOptions;
  try {
    options = parseImportArgs(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    io.err(`${error.message}\n\n${USAGE}`);
    return EXIT_USAGE;
  }
  if (options.help) {
    io.out(USAGE);
    return EXIT_OK;
  }

  const parsedEnv = envSchema.safeParse(env);
  if (!parsedEnv.success) {
    io.err(
      `The configuration is not valid:\n${z.prettifyError(parsedEnv.error)}`,
    );
    return EXIT_USAGE;
  }
  const config = parsedEnv.data;
  const tenantId = options.tenant ?? config.DEFAULT_TENANT_ID;

  let fixes: TextFixes;
  let rows: ZomatoRow[];
  try {
    fixes = await loadTextFixes(options.textFixes);
    rows = await readZomatoCsv(options.file);
  } catch (error) {
    io.err(describeError(error));
    return EXIT_FAILED;
  }

  let outcome: ImportOutcome;
  try {
    outcome = options.dryRun
      ? await importRestaurants(rows, fixes, { batchSize: options.batchSize })
      : await importIntoMongo(
          rows,
          fixes,
          options.batchSize,
          config,
          tenantId,
          io,
          dependencies,
        );
  } catch (error) {
    io.err(
      `The import stopped: ${describeError(error)}\n` +
        'What was written stays, and running the import again is safe.',
    );
    return EXIT_FAILED;
  }

  const expected = expectedNumbersFor(outcome.stats.rowsRead);
  const report: ImportReport = {
    file: options.file,
    tenantId,
    target: options.dryRun
      ? undefined
      : { database: config.MONGODB_DB, collection: RESTAURANTS_COLLECTION },
    fixesLoaded: fixes.size,
    stats: outcome.stats,
    rejected: outcome.rejected,
    writes: outcome.writes,
    collection: outcome.collection,
    checks: expected
      ? compareWithExpected(outcome.stats, expected, outcome.collection)
      : undefined,
  };
  io.out(formatReport(report));
  return reportPassed(report) ? EXIT_OK : EXIT_FAILED;
}

/** Connects, makes sure the collection and its indexes exist, imports, and always disconnects. */
async function importIntoMongo(
  rows: readonly ZomatoRow[],
  fixes: TextFixes,
  batchSize: number,
  config: Env,
  tenantId: string,
  io: CliIo,
  dependencies: CliDependencies,
): Promise<ImportOutcome> {
  const client = await dependencies.connect(
    config.MONGODB_URI,
    'biteexpress-importer',
  );
  try {
    const db = client.db(config.MONGODB_DB);
    await dependencies.ensureSchema(db, {
      log: (message) => io.out(`[schema] ${message}`),
      warn: (message) => io.err(`[schema] warning: ${message}`),
    });
    const sink = new MongoRestaurantSink(
      db.collection(RESTAURANTS_COLLECTION),
      tenantId,
      dependencies.now(),
    );
    return await importRestaurants(rows, fixes, { batchSize }, sink);
  } finally {
    await client.close().catch(() => undefined);
  }
}
