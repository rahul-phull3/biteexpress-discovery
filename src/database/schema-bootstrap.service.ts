import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Db } from 'mongodb';
import { MONGO_DB } from './database.constants';
import { ensureRestaurantsSchema } from './schema-bootstrap';

/**
 * Runs the schema bootstrap once, after the MongoDB connection exists and
 * before the server starts listening, so the first request already finds the
 * collection, validator and indexes in place.
 */
@Injectable()
export class SchemaBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(SchemaBootstrapService.name);

  constructor(@Inject(MONGO_DB) private readonly db: Db) {}

  async onModuleInit(): Promise<void> {
    await ensureRestaurantsSchema(this.db, this.logger);
  }
}
