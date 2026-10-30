import { Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MongoClient } from 'mongodb';
import type { Env } from '../config/env.schema';
import { MONGO_CLIENT, MONGO_DB } from './database.constants';
import { createMongoClient } from './mongo-client.factory';
import { SchemaBootstrapService } from './schema-bootstrap.service';

/**
 * Owns the MongoDB connection. Other modules import it and inject MONGO_DB;
 * none of them creates a client of its own.
 */
@Module({
  providers: [
    {
      provide: MONGO_CLIENT,
      inject: [ConfigService],
      useFactory: createMongoClient,
    },
    {
      provide: MONGO_DB,
      inject: [MONGO_CLIENT, ConfigService],
      useFactory: (client: MongoClient, config: ConfigService<Env, true>) =>
        client.db(config.get('MONGODB_DB', { infer: true })),
    },
    SchemaBootstrapService,
  ],
  exports: [MONGO_CLIENT, MONGO_DB],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(MONGO_CLIENT) private readonly client: MongoClient) {}

  /** Closes the connection pool when the app shuts down (Ctrl+C, SIGTERM). */
  async onApplicationShutdown(): Promise<void> {
    await this.client.close();
  }
}
