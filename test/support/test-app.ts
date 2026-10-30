import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { MONGO_CLIENT, MONGO_DB } from '../../src/database/database.constants';
import { SchemaBootstrapService } from '../../src/database/schema-bootstrap.service';
import type { FakeDb } from './fake-db';

/**
 * Builds the real application with MongoDB swapped for a FakeDb, so the HTTP
 * layer can be tested without a database. Anything that needs a real MongoDB
 * belongs in test/mongo.int-spec.ts instead.
 */
export async function createAppWithFakeMongo(
  fake: FakeDb,
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MONGO_CLIENT)
    .useValue({ close: async () => undefined })
    .overrideProvider(MONGO_DB)
    .useValue(fake.asDb())
    .overrideProvider(SchemaBootstrapService)
    .useValue({})
    .compile();

  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}
