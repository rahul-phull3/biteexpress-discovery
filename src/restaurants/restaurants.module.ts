import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Db } from 'mongodb';
import type { Env } from '../config/env.schema';
import { MONGO_DB, MONGO_READ_TIMEOUT_MS } from '../database/database.constants';
import { DatabaseModule } from '../database/database.module';
import { createTextSearch } from './atlas-text-search';
import { MongoRestaurantStore } from './mongo-restaurant.store';
import { RestaurantsController } from './restaurants.controller';
import { RestaurantsService } from './restaurants.service';
import { RESTAURANT_STORE } from './restaurant.store';
import { TEXT_SEARCH, type TextSearch } from './text-search';
import { VocabularyService } from './vocabulary.service';

@Module({
  imports: [DatabaseModule],
  controllers: [RestaurantsController],
  providers: [
    RestaurantsService,
    VocabularyService,
    {
      // The READ_TIMEOUT_MS setting, as the time limit of every read of the store.
      provide: MONGO_READ_TIMEOUT_MS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        config.get('READ_TIMEOUT_MS', { infer: true }),
    },
    { provide: RESTAURANT_STORE, useClass: MongoRestaurantStore },
    {
      // Atlas Search or the plain rules, as the SEARCH_ENGINE setting says.
      provide: TEXT_SEARCH,
      inject: [MONGO_DB, ConfigService],
      useFactory: (db: Db, config: ConfigService<Env, true>): TextSearch =>
        createTextSearch(db, {
          engine: config.get('SEARCH_ENGINE', { infer: true }),
          timeoutMs: config.get('READ_TIMEOUT_MS', { infer: true }),
        }),
    },
  ],
})
export class RestaurantsModule {}
