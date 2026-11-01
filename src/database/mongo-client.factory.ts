import type { ConfigService } from '@nestjs/config';
import { MongoClient } from 'mongodb';
import type { Env } from '../config/env.schema';
import { redactMongoUri } from './mongo-uri';

/**
 * Creates a MongoClient and connects it. Connecting here, not lazily on the
 * first query, means a wrong address or a stopped database stops the process
 * at the start with a clear message instead of failing the first request. The
 * API and the importer both use it.
 *
 * appName shows up in the server log and in db.currentOp(), which helps when
 * several applications share one cluster.
 */
export async function connectMongo(
  uri: string,
  appName = 'biteexpress-discovery',
): Promise<MongoClient> {
  const client = new MongoClient(uri, {
    appName,
    // Give up after 5 seconds when nothing answers, not the 30 second default.
    serverSelectionTimeoutMS: 5000,
  });

  try {
    await client.connect();
  } catch (cause) {
    await client.close().catch(() => undefined);
    throw new Error(
      `Could not connect to MongoDB at ${redactMongoUri(uri)}. ` +
        'Is it running? Start the local database with: npm run db:up',
      { cause },
    );
  }
  return client;
}

/** The process-wide client of the API, from the validated configuration. */
export function createMongoClient(
  config: ConfigService<Env, true>,
): Promise<MongoClient> {
  return connectMongo(config.get('MONGODB_URI', { infer: true }));
}
