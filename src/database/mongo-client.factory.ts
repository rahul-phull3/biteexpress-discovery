import type { ConfigService } from '@nestjs/config';
import { MongoClient } from 'mongodb';
import type { Env } from '../config/env.schema';
import { redactMongoUri } from './mongo-uri';

/**
 * Creates the process-wide MongoClient and connects it. Connecting here, not
 * lazily on the first query, means a wrong address or a stopped database stops
 * the app at boot with a clear message instead of failing the first request.
 */
export async function createMongoClient(
  config: ConfigService<Env, true>,
): Promise<MongoClient> {
  const uri = config.get('MONGODB_URI', { infer: true });

  const client = new MongoClient(uri, {
    // Shows up in the server log and in db.currentOp(), which helps when
    // several applications share one cluster.
    appName: 'biteexpress-discovery',
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
