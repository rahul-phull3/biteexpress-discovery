import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { MONGO_CLIENT, MONGO_DB } from '../../src/database/database.constants';
import { SchemaBootstrapService } from '../../src/database/schema-bootstrap.service';
import { setupApiDocs } from '../../src/docs/api-docs';
import {
  RESTAURANT_STORE,
  type RestaurantStore,
} from '../../src/restaurants/restaurant.store';
import {
  RulesTextSearch,
  TEXT_SEARCH,
  type TextSearch,
} from '../../src/restaurants/text-search';
import type { FakeDb } from './fake-db';

export interface TestAppOptions {
  /**
   * Replaces the MongoDB-backed restaurant store, for example with an
   * InMemoryRestaurantStore. Without it the restaurant routes would call the
   * FakeDb, which only knows the startup and readiness calls.
   */
  restaurantStore?: RestaurantStore;
  /** Serves the Swagger UI and the OpenAPI document, as main.ts does when DOCS_ENABLED. */
  docs?: boolean;
  /**
   * How the leftover words of a sentence are matched. Without it the plain
   * rules, because Atlas Search needs a real MongoDB with its search process.
   */
  textSearch?: TextSearch;
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
    .useValue({})
    .overrideProvider(TEXT_SEARCH)
    .useValue(options.textSearch ?? new RulesTextSearch());

  if (options.restaurantStore) {
    builder = builder
      .overrideProvider(RESTAURANT_STORE)
      .useValue(options.restaurantStore);
  }

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  // Before init(): Nest installs its 404 handler then, and a route added after it is never reached.
  if (options.docs) setupApiDocs(app);
  await app.init();
  return app;
}
