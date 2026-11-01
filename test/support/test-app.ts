import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { MONGO_CLIENT, MONGO_DB } from '../../src/database/database.constants';
import { SchemaBootstrapService } from '../../src/database/schema-bootstrap.service';
import {
  RESTAURANT_STORE,
  type RestaurantStore,
} from '../../src/restaurants/restaurant.store';
import type { FakeDb } from './fake-db';

export interface TestAppOptions {
  /**
   * Replaces the MongoDB-backed restaurant store, for example with an
   * InMemoryRestaurantStore. Without it the restaurant routes would call the
   * FakeDb, which only knows the startup and readiness calls.
   */
  restaurantStore?: RestaurantStore;
}

/**
 * Builds the real application with MongoDB swapped for a FakeDb, so the HTTP
 * layer can be tested without a database. Anything that needs a real MongoDB
 * belongs in test/*.int-spec.ts instead.
 *
 * Nest's logger is switched off: the access log and the error log would
 * otherwise fill the test output with lines nobody asserts on.
 */
export async function createAppWithFakeMongo(
  fake: FakeDb,
  options: TestAppOptions = {},
): Promise<INestApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MONGO_CLIENT)
    .useValue({ close: async () => undefined })
    .overrideProvider(MONGO_DB)
    .useValue(fake.asDb())
    .overrideProvider(SchemaBootstrapService)
    .useValue({});

  if (options.restaurantStore) {
    builder = builder
      .overrideProvider(RESTAURANT_STORE)
      .useValue(options.restaurantStore);
  }

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();
  return app;
}
